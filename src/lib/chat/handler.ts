/**
 * Chat Handler — DB-Backed State Machine (POST + SSE)
 *
 * Transport-agnostic handler. Broadcasts events to all SSE connections
 * for a user. The server is the single source of truth.
 *
 * State machine phases (stored in DB):
 *   idle              → waiting for user message
 *   waiting_for_answer → question sent, waiting for user answer
 *   tool_pending       → API tools queued, waiting to execute
 *
 * Protocol — client → server (POST /api/chat/message):
 *   { type: "message", text: "..." }
 *   { type: "answer",  text: "..." }
 *
 * Protocol — server → client (SSE /api/chat/events):
 *   thinking, text, tool_start, tool_end, question, done, error
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { buildToolDefinitions, executeTool, isClientSideTool } from './tools';
import { buildSystemPrompt } from './prompt';

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

// ─── Types ──────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'waiting_for_answer' | 'tool_pending';

type StoredMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: Anthropic.ContentBlock[] }
  | { role: 'user'; content: Anthropic.ToolResultBlockParam[] }
  | { role: 'cancel'; content: string };

interface QuestionInput {
  type: 'multiple_choice' | 'text';
  question: string;
  options?: string[];
}

/** Stored in the DB `messages` JSONB column */
interface ConversationRecord {
  v: 1;
  phase: Phase;
  messages: StoredMessage[];
  pendingQuestion: QuestionInput | null;
}

// ─── Connection Registry + Locking ──────────────────────────────────────────

const activeSessions = new Map<string, string>();  // userId → lockId
const connections = new Map<string, Set<SSEWriter>>();  // userId → all SSE connections
const memoryRecords = new Map<string, ConversationRecord>();  // userId → in-memory record (skipPersistence mode)

let lockCounter = 0;

/** Clear in-memory conversation record (for tests). */
export function clearMemoryRecord(userId: string): void {
  memoryRecords.delete(userId);
}

export function acquireLock(userId: string): string | null {
  if (activeSessions.has(userId)) return null;
  const lockId = `lock-${++lockCounter}-${Date.now()}`;
  activeSessions.set(userId, lockId);
  return lockId;
}

export function releaseLock(userId: string, lockId: string): void {
  if (activeSessions.get(userId) === lockId) {
    activeSessions.delete(userId);
  }
}

export function addConnection(userId: string, writer: SSEWriter): () => void {
  let set = connections.get(userId);
  if (!set) {
    set = new Set();
    connections.set(userId, set);
  }
  set.add(writer);

  // Return unsubscribe function
  return () => {
    set!.delete(writer);
    if (set!.size === 0) connections.delete(userId);
  };
}

export function broadcast(userId: string, event: string, data: unknown): void {
  const set = connections.get(userId);
  if (!set) return;
  for (const writer of set) {
    try {
      writer.write(event, data);
    } catch {
      // Writer closed — ignore, will be cleaned up on disconnect
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Load a ConversationRecord from the raw JSONB value. */
const loadRecord = (raw: unknown): ConversationRecord => {
  if (raw && typeof raw === 'object' && (raw as any).v === 1) {
    return raw as ConversationRecord;
  }
  return { v: 1, phase: 'idle', messages: [], pendingQuestion: null };
};

/**
 * Convert StoredMessage[] → Claude MessageParam[], merging consecutive
 * same-role messages.
 */
const toClaudeMessages = (msgs: StoredMessage[]): Anthropic.MessageParam[] => {
  const result: Anthropic.MessageParam[] = [];

  for (const m of msgs) {
    if (m.role === 'cancel') continue;
    const role: 'user' | 'assistant' = m.role === 'user' ? 'user' : 'assistant';

    const prev = result[result.length - 1];
    if (prev && prev.role === role) {
      const prevArr = Array.isArray(prev.content)
        ? (prev.content as Anthropic.ContentBlockParam[])
        : [{ type: 'text' as const, text: prev.content as string }];
      const curArr = typeof m.content === 'string'
        ? [{ type: 'text' as const, text: m.content }]
        : (m.content as Anthropic.ContentBlockParam[]);
      const merged = [...prevArr, ...curArr];
      const toolResults = merged.filter((b) => (b as any).type === 'tool_result');
      const rest = merged.filter((b) => (b as any).type !== 'tool_result');
      prev.content = [...toolResults, ...rest];
      continue;
    }

    if (role === 'user') {
      result.push({ role, content: m.content });
    } else {
      const cleaned = (m.content as any[]).map((block) => {
        if (block.type === 'tool_use') {
          const { id, type, name, input } = block;
          return { type, id, name, input };
        }
        if (block.type === 'text') {
          return { type: block.type, text: block.text };
        }
        return block;
      });
      result.push({ role, content: cleaned as Anthropic.ContentBlockParam[] });
    }
  }

  return result;
};

/**
 * Sanitize Claude messages: strip tool_use blocks that don't have matching
 * tool_result blocks in the immediately following message.
 */
const sanitizeMessages = (msgs: Anthropic.MessageParam[]): Anthropic.MessageParam[] => {
  const result: Anthropic.MessageParam[] = [];

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];

    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const blocks = msg.content as Anthropic.ContentBlockParam[];
      const toolUseIds = blocks
        .filter((b): b is Anthropic.ToolUseBlockParam => (b as any).type === 'tool_use')
        .map((b) => b.id);

      if (toolUseIds.length > 0) {
        const next = msgs[i + 1];
        const resultIds = new Set<string>();
        if (next?.role === 'user' && Array.isArray(next.content)) {
          for (const b of next.content as any[]) {
            if (b.type === 'tool_result') resultIds.add(b.tool_use_id);
          }
        }

        const allMatched = toolUseIds.every((id) => resultIds.has(id));
        if (!allMatched) {
          const safe = blocks.filter((b) => (b as any).type !== 'tool_use');
          if (safe.length > 0) {
            result.push({ ...msg, content: safe });
          }
          continue;
        }
      }
    }

    result.push(msg);
  }

  return result;
};

const contentSize = (msg: StoredMessage): number =>
  typeof msg.content === 'string' ? msg.content.length : JSON.stringify(msg.content).length;

const isToolResultMsg = (msg: StoredMessage): boolean =>
  msg.role === 'user' && Array.isArray(msg.content) &&
  msg.content.length > 0 && (msg.content[0] as any)?.type === 'tool_result';

const hasToolUse = (msg: StoredMessage): boolean =>
  msg.role === 'assistant' && Array.isArray(msg.content) &&
  (msg.content as any[]).some((b) => b.type === 'tool_use');

const trimMessages = (msgs: StoredMessage[]): StoredMessage[] => {
  const CHAR_LIMIT = 3000;
  if (msgs.length <= 1) return msgs;

  type Chunk = StoredMessage[];
  const chunks: Chunk[] = [];
  let ci = 0;

  while (ci < msgs.length) {
    const msg = msgs[ci];

    if (hasToolUse(msg)) {
      const group: StoredMessage[] = [msg];
      let j = ci + 1;
      while (j < msgs.length) {
        group.push(msgs[j]);
        if (isToolResultMsg(msgs[j])) { j++; break; }
        j++;
      }
      chunks.push(group);
      ci = j;
      continue;
    }

    chunks.push([msg]);
    ci++;
  }

  const chunkSize = (chunk: Chunk) => chunk.reduce((s, m) => s + contentSize(m), 0);

  const firstChunk = chunks[0];
  let budget = CHAR_LIMIT - chunkSize(firstChunk);
  const tail: Chunk[] = [];

  for (let i = chunks.length - 1; i >= 1 && budget > 0; i--) {
    const size = chunkSize(chunks[i]);
    if (size > budget) break;
    budget -= size;
    tail.unshift(chunks[i]);
  }

  return [...firstChunk, ...tail.flat()];
};

const getLastToolUseBlocks = (messages: StoredMessage[]): Anthropic.ToolUseBlock[] | null => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const blocks = (msg.content as Anthropic.ContentBlock[]).filter(
        (b) => b.type === 'tool_use',
      ) as Anthropic.ToolUseBlock[];
      return blocks.length > 0 ? blocks : null;
    }
    break;
  }
  return null;
};

// ─── Main Handler ───────────────────────────────────────────────────────────

export async function handleChatMessage(
  userId: string,
  config: ChatConfig,
  locale: string,
  body: { type: string; text: string },
): Promise<void> {
  console.log(`[chat] handleChatMessage user=${userId} type=${body.type}`);

  const supabase = (!config.customerToken || !config.skipPersistence)
    ? createClient(config.supabaseUrl, config.supabaseServiceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

  // ── Per-request state ─────────────────────────────────────────────────────
  let record: ConversationRecord = { v: 1, phase: 'idle', messages: [], pendingQuestion: null };
  let customerToken: string | null = null;
  let configSchema: string | undefined;

  // ── Persist ───────────────────────────────────────────────────────────────

  const persist = async () => {
    if (config.skipPersistence) {
      // In-memory fallback for test/no-DB mode
      memoryRecords.set(userId, record);
      return;
    }
    if (!supabase) return;
    try {
      await supabase
        .from('machine_config_chat')
        .upsert({ user_id: userId, messages: record }, { onConflict: 'user_id' });
    } catch {
      // Ignore persistence errors
    }
  };

  const setPhase = async (phase: Phase, pendingQuestion?: QuestionInput | null) => {
    record.phase = phase;
    record.pendingQuestion = pendingQuestion ?? null;
    await persist();
  };

  // ── Init ──────────────────────────────────────────────────────────────────

  // Customer token
  if (config.customerToken) {
    customerToken = config.customerToken;
  } else {
    if (!supabase) {
      broadcast(userId, 'error', { type: 'error', message: 'No customer token configured' });
      return;
    }
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('customer_token')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileError || !profile?.customer_token) {
      console.warn('[chat] No customer token for user', userId, profileError?.message);
      broadcast(userId, 'error', { type: 'error', message: 'No customer token configured' });
      return;
    }
    customerToken = profile.customer_token as string;
  }

  // Config schema + conversation record in parallel
  const schemaPromise = fetch(`${config.macMgmtUrl}/api/setting/config/schema`, {
    headers: { Authorization: `Bearer ${customerToken}`, Accept: 'application/json' },
  }).then((res) => res.ok ? res.text() : undefined).catch(() => undefined);

  const recordPromise = (async () => {
    if (config.skipPersistence) {
      return memoryRecords.get(userId) ?? null;
    }
    if (supabase) {
      const { data: chatRow } = await supabase
        .from('machine_config_chat')
        .select('messages')
        .eq('user_id', userId)
        .maybeSingle();
      return chatRow?.messages ? loadRecord(chatRow.messages) : null;
    }
    return null;
  })();

  const [schema, loadedRecord] = await Promise.all([schemaPromise, recordPromise]);
  configSchema = schema;
  if (loadedRecord) record = loadedRecord;

  console.log(`[chat] Loaded: ${record.messages.length} msgs, phase=${record.phase}`);

  // ── Handle incoming message based on type and current phase ────────────────

  if (body.type === 'answer') {
    // Answer to a pending question — resume from waiting_for_answer
    if (record.phase !== 'waiting_for_answer') {
      broadcast(userId, 'error', { type: 'error', message: 'No pending question to answer' });
      return;
    }

    const answer = body.text;
    const cancelled = answer === '__cancel__';

    const toolUseBlocks = getLastToolUseBlocks(record.messages);
    if (!toolUseBlocks) {
      broadcast(userId, 'error', { type: 'error', message: 'Resume error: no tool_use blocks found' });
      return;
    }

    const clientToolBlock = toolUseBlocks.find((b) => isClientSideTool(b.name));

    if (cancelled) {
      record.messages.push({ role: 'cancel', content: '' });
    } else {
      record.messages.push({ role: 'user', content: answer });
    }

    const toolResults = buildQuestionToolResults(
      toolUseBlocks,
      clientToolBlock?.id ?? '',
      answer,
      cancelled,
    );
    record.messages.push({ role: 'user', content: toolResults });
    await setPhase('idle');
  } else if (body.type === 'message') {
    // New user message
    if (record.phase === 'waiting_for_answer' || record.phase === 'tool_pending') {
      broadcast(userId, 'error', { type: 'error', message: 'A conversation turn is already in progress' });
      return;
    }

    record.messages.push({ role: 'user', content: body.text });
    await setPhase('idle');
  } else {
    broadcast(userId, 'error', { type: 'error', message: `Unknown message type: ${body.type}` });
    return;
  }

  // ── Run the tool loop ─────────────────────────────────────────────────────

  await runToolLoop(userId, config, record, customerToken!, locale, configSchema, setPhase);
}

// ─── Question Tool Results ──────────────────────────────────────────────────

const buildQuestionToolResults = (
  toolUseBlocks: Anthropic.ToolUseBlock[],
  clientToolId: string,
  answer: string,
  cancelled: boolean,
): Anthropic.ToolResultBlockParam[] =>
  toolUseBlocks.map((b) => ({
    type: 'tool_result' as const,
    tool_use_id: b.id,
    ...(b.id === clientToolId
      ? cancelled
        ? { content: 'The user cancelled this question.', is_error: true }
        : { content: answer }
      : { content: 'Skipped — paused for user question.' }),
  }));

// ─── Tool Loop ──────────────────────────────────────────────────────────────

async function runToolLoop(
  userId: string,
  config: ChatConfig,
  record: ConversationRecord,
  customerToken: string,
  locale: string,
  configSchema: string | undefined,
  setPhase: (phase: Phase, pendingQuestion?: QuestionInput | null) => Promise<void>,
): Promise<void> {
  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  const systemPrompt = buildSystemPrompt(locale, configSchema);
  const tools = buildToolDefinitions();

  // ── Pre-step: resume from tool_pending ──────────────────────────────────

  if (record.phase === 'tool_pending') {
    broadcast(userId, 'thinking', { type: 'thinking' });

    const toolUseBlocks = getLastToolUseBlocks(record.messages);
    if (!toolUseBlocks) throw new Error('Resume error: no tool_use blocks found');

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      broadcast(userId, 'tool_start', { type: 'tool_start', name: block.name });
      const result = await executeTool(
        block.name,
        (block.input ?? {}) as Record<string, unknown>,
        customerToken,
        config.macMgmtUrl,
      );
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
      broadcast(userId, 'tool_end', { type: 'tool_end', name: block.name });
    }

    record.messages.push({ role: 'user', content: toolResults });
    await setPhase('idle');
  }

  // ── Main loop ─────────────────────────────────────────────────────────────

  const MAX_TOOL_ROUNDS = 10;
  let rounds = 0;

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    const trimmed = trimMessages(record.messages.filter((m) => m.role !== 'cancel'));
    const claudeMessages = sanitizeMessages(toClaudeMessages(trimmed));
    console.log(`[chat] Round ${rounds}/${MAX_TOOL_ROUNDS}, ${claudeMessages.length} msgs`);

    broadcast(userId, 'thinking', { type: 'thinking' });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: systemPrompt,
      tools,
      messages: claudeMessages,
    });

    const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use') as Anthropic.ToolUseBlock[];
    const textBlocks = response.content.filter((b) => b.type === 'text') as Anthropic.TextBlock[];
    console.log(`[chat] stop=${response.stop_reason}, ${toolUseBlocks.length} tools, ${textBlocks.length} text`);

    for (const block of textBlocks) {
      if (block.text) broadcast(userId, 'text', { type: 'text', content: block.text });
    }

    // ── Final response (no tools or end_turn) ──────────────────────────────
    if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
      const safeContent = response.content.filter((b) => b.type !== 'tool_use');
      if (safeContent.length > 0) {
        record.messages.push({ role: 'assistant', content: safeContent });
      }
      await setPhase('idle');
      broadcast(userId, 'done', { type: 'done' });
      return;
    }

    // Store full assistant response (tool_use blocks included)
    record.messages.push({ role: 'assistant', content: response.content });

    // ── ask_question ────────────────────────────────────────────────────────
    const clientToolBlock = toolUseBlocks.find((b) => isClientSideTool(b.name));

    if (clientToolBlock) {
      rounds--;

      const questionInput = clientToolBlock.input as QuestionInput;

      // Persist phase BEFORE sending question — resumable checkpoint
      await setPhase('waiting_for_answer', questionInput);
      broadcast(userId, 'question', { type: 'question', question: questionInput });

      // Return — the next POST will resume with an answer
      return;
    }

    // ── API tools ───────────────────────────────────────────────────────────
    await setPhase('tool_pending');

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      broadcast(userId, 'tool_start', { type: 'tool_start', name: block.name });
      const result = await executeTool(
        block.name,
        (block.input ?? {}) as Record<string, unknown>,
        customerToken,
        config.macMgmtUrl,
      );
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
      broadcast(userId, 'tool_end', { type: 'tool_end', name: block.name });
    }

    record.messages.push({ role: 'user', content: toolResults });
    await setPhase('idle');
  }

  // Safety: max rounds
  const msg = "I've been working on your request but it required too many steps. Could you try a more specific request?";
  record.messages.push({
    role: 'assistant',
    content: [{ type: 'text', text: msg, citations: [] }] as Anthropic.ContentBlock[],
  });
  await setPhase('idle');
  broadcast(userId, 'text', { type: 'text', content: msg });
  broadcast(userId, 'done', { type: 'done' });
}
