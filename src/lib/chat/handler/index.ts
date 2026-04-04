/**
 * Chat Handler — DB-Backed State Machine (POST + SSE)
 *
 * Transport-agnostic handler. Broadcasts events to all SSE connections
 * for a user. The server is the single source of truth.
 *
 * State machine phases (stored in DB):
 *   idle              -> waiting for user message
 *   waiting_for_answer -> question sent, waiting for user answer
 *   tool_pending       -> API tools queued, waiting to execute
 *
 * Protocol — client -> server (POST /api/chat/message):
 *   { type: "message", text: "..." }
 *   { type: "answer",  text: "..." }
 *
 * Protocol — server -> client (SSE /api/chat/events):
 *   thinking, text_delta, text_done, tool_start, tool_end, question, done, error
 *   (text kept as fallback for backwards compat)
 */

import { createClient } from '@supabase/supabase-js';
import { isClientSideTool } from '../tools';
import type { ChatModeConfig, ModeContext } from '../modes';

// Re-export persistence types and functions
export type { Phase, StoredMessage, ClientToolPrompt, MemoryState, PersistenceAdapter } from './persistence';
export { memoryRecords, loadState, loadMessages, upsertState, appendMessage, extractDisplayText, createDbAdapter, createMemoryAdapter } from './persistence';

// Re-export message utilities
export { toClaudeMessages, sanitizeMessages, trimMessages, addConversationCacheBreakpoint, contentSize, isToolResultMsg, hasToolUse, getLastToolUseBlocks } from './messageUtils';

// Re-export token budget
export { checkTokenBudget, recordTokenUsage, INPUT_TOKEN_BUDGET_PER_HOUR, OUTPUT_TOKEN_BUDGET_PER_HOUR } from './tokenBudget';

// Re-export tool loop
export { runToolLoop, buildQuestionToolResults } from './toolLoop';

// Import for internal use
import type { Phase, StoredMessage, ClientToolPrompt } from './persistence';
import { memoryRecords, loadState, loadMessages, createDbAdapter, createMemoryAdapter } from './persistence';
import { getLastToolUseBlocks } from './messageUtils';
import { checkTokenBudget, INPUT_TOKEN_BUDGET_PER_HOUR, OUTPUT_TOKEN_BUDGET_PER_HOUR } from './tokenBudget';
import { runToolLoop, buildQuestionToolResults } from './toolLoop';

// ─── Public Interfaces ──────────────────────────────────────────────────────

export interface SSEWriter {
  write(event: string, data: unknown): void;
  end(): void;
}

export interface ChatConfig {
  anthropicApiKey: string;
  macMgmtUrl: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
  customerToken?: string;
  skipPersistence?: boolean;
}

// ─── Connection Registry + Locking ──────────────────────────────────────────

const activeSessions = new Map<string, string>();  // compositeKey -> lockId
const connections = new Map<string, Set<SSEWriter>>();  // compositeKey -> all SSE connections

let lockCounter = 0;

/** Build composite key for per-user-per-mode isolation */
export function compositeKey(userId: string, modeId: string): string {
  return `${userId}:${modeId}`;
}

/** Clear in-memory conversation records for a user across all modes (for tests). */
export function clearMemoryRecord(userId: string): void {
  for (const key of memoryRecords.keys()) {
    if (key === userId || key.startsWith(`${userId}:`)) {
      memoryRecords.delete(key);
    }
  }
}

export function acquireLock(key: string): string | null {
  if (activeSessions.has(key)) return null;
  const lockId = `lock-${++lockCounter}-${Date.now()}`;
  activeSessions.set(key, lockId);
  return lockId;
}

export function releaseLock(key: string, lockId: string): void {
  if (activeSessions.get(key) === lockId) {
    activeSessions.delete(key);
  }
}

export function addConnection(key: string, writer: SSEWriter): () => void {
  let set = connections.get(key);
  if (!set) {
    set = new Set();
    connections.set(key, set);
  }
  set.add(writer);

  // Return unsubscribe function
  return () => {
    set!.delete(writer);
    if (set!.size === 0) connections.delete(key);
  };
}

export function broadcast(key: string, event: string, data: unknown): void {
  const set = connections.get(key);
  if (!set) return;
  for (const writer of set) {
    try {
      writer.write(event, data);
    } catch {
      // Writer closed — ignore, will be cleaned up on disconnect
    }
  }
}

// ─── Main Handler ───────────────────────────────────────────────────────────

export async function handleChatMessage(
  userId: string,
  config: ChatConfig,
  locale: string,
  body: { type: string; text: string },
  mode: ChatModeConfig,
): Promise<void> {
  const connKey = compositeKey(userId, mode.id);
  console.log(`[chat] handleChatMessage user=${userId} mode=${mode.id} type=${body.type}`);

  const supabase = (!config.customerToken || !config.skipPersistence)
    ? createClient(config.supabaseUrl, config.supabaseServiceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

  // ── Token rate limiting ──────────────────────────────────────────────────
  if (supabase) {
    const { allowed, inputUsed, outputUsed } = await checkTokenBudget(supabase, userId);
    if (!allowed) {
      const parts: string[] = [];
      if (inputUsed >= INPUT_TOKEN_BUDGET_PER_HOUR) {
        parts.push(`input: ${inputUsed.toLocaleString()}/${INPUT_TOKEN_BUDGET_PER_HOUR.toLocaleString()}`);
      }
      if (outputUsed >= OUTPUT_TOKEN_BUDGET_PER_HOUR) {
        parts.push(`output: ${outputUsed.toLocaleString()}/${OUTPUT_TOKEN_BUDGET_PER_HOUR.toLocaleString()}`);
      }
      broadcast(connKey, 'error', {
        type: 'error',
        message: `Token rate limit exceeded (${parts.join(', ')}) in the last hour`,
      });
      return;
    }
  }

  // ── Per-request state ─────────────────────────────────────────────────────
  let phase: Phase = 'idle';
  let pendingQuestion: ClientToolPrompt | null = null;
  let messages: StoredMessage[] = [];
  let modeContext: ModeContext = {};

  // ── Mode-specific preparation ───────────────────────────────────────────

  const preparePromise = mode.prepare
    ? mode.prepare(userId, config, supabase)
    : Promise.resolve(null);

  const recordPromise = (async () => {
    if (config.skipPersistence) {
      const rec = memoryRecords.get(connKey);
      return rec ? { phase: rec.phase, pendingQuestion: rec.pendingQuestion, messages: rec.messages } : null;
    }
    if (supabase) {
      const [state, msgs] = await Promise.all([
        loadState(supabase, userId, mode.stateTable, mode.modeColumn),
        loadMessages(supabase, userId, mode.messagesTable, mode.modeColumn),
      ]);
      return { phase: state.phase, pendingQuestion: state.pendingQuestion, messages: msgs };
    }
    return null;
  })();

  const [prepareResult, loadedRecord] = await Promise.all([preparePromise, recordPromise]);

  // Check if prepare() signaled failure (e.g. missing customer token)
  if (mode.prepare && prepareResult === null) {
    broadcast(connKey, 'error', { type: 'error', message: 'Mode setup failed — missing required configuration' });
    return;
  }

  if (prepareResult) {
    modeContext = prepareResult;
  }

  if (loadedRecord) {
    phase = loadedRecord.phase;
    pendingQuestion = loadedRecord.pendingQuestion;
    messages = loadedRecord.messages;
  }

  console.log(`[chat] Loaded: ${messages.length} msgs, phase=${phase}`);

  // ── Ordinal tracking ──────────────────────────────────────────────────────
  const ordinalRef = { value: messages.length };

  // ── Persistence adapter ───────────────────────────────────────────────────
  const adapter = (config.skipPersistence || !supabase)
    ? createMemoryAdapter(connKey, messages)
    : createDbAdapter(supabase, userId, messages, ordinalRef, mode.stateTable, mode.messagesTable, mode.modeColumn);

  const setPhase = async (p: Phase, pq?: ClientToolPrompt | null) => {
    phase = p;
    pendingQuestion = pq ?? null;
    await adapter.setPhase(p, pq);
  };

  const appendMsg = async (msg: StoredMessage) => {
    await adapter.appendMsg(msg);
  };

  // ── Handle incoming message based on type and current phase ────────────────

  if (body.type === 'answer') {
    // Answer to a pending question — resume from waiting_for_answer
    if (phase !== 'waiting_for_answer') {
      broadcast(connKey, 'error', { type: 'error', message: 'No pending question to answer' });
      return;
    }

    const answer = body.text;
    const cancelled = answer === '__cancel__';

    const toolUseBlocks = getLastToolUseBlocks(messages);
    if (!toolUseBlocks) {
      broadcast(connKey, 'error', { type: 'error', message: 'Resume error: no tool_use blocks found' });
      return;
    }

    const clientToolBlock = toolUseBlocks.find((b) => isClientSideTool(b.name));

    if (cancelled) {
      await appendMsg({ role: 'cancel', content: '' });
    } else {
      await appendMsg({ role: 'user', content: answer });
    }

    const toolResults = buildQuestionToolResults(
      toolUseBlocks,
      clientToolBlock?.id ?? '',
      answer,
      cancelled,
    );
    await appendMsg({ role: 'user', content: toolResults });
    await setPhase('idle');
  } else if (body.type === 'message') {
    // New user message
    if (phase === 'waiting_for_answer' || phase === 'tool_pending') {
      broadcast(connKey, 'error', { type: 'error', message: 'A conversation turn is already in progress' });
      return;
    }

    await appendMsg({ role: 'user', content: body.text });
    await setPhase('idle');
  } else {
    broadcast(connKey, 'error', { type: 'error', message: `Unknown message type: ${body.type}` });
    return;
  }

  // ── Run the tool loop ─────────────────────────────────────────────────────

  await runToolLoop(userId, config, messages, phase, mode, modeContext, locale, connKey, setPhase, appendMsg, supabase);
}
