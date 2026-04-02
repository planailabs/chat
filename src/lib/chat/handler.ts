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
 *   thinking, text_delta, text_done, tool_start, tool_end, question, done, error
 *   (text kept as fallback for backwards compat)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
  | { id?: string; role: 'user'; content: string }
  | { id?: string; role: 'assistant'; content: Anthropic.ContentBlock[] }
  | { id?: string; role: 'user'; content: Anthropic.ToolResultBlockParam[] }
  | { id?: string; role: 'cancel'; content: string };

interface QuestionInput {
  type: 'multiple_choice' | 'text';
  question: string;
  options?: string[];
}

/** In-memory state for skipPersistence mode */
interface MemoryState {
  phase: Phase;
  pendingQuestion: QuestionInput | null;
  messages: StoredMessage[];
}

// ─── Connection Registry + Locking ──────────────────────────────────────────

const activeSessions = new Map<string, string>();  // userId → lockId
const connections = new Map<string, Set<SSEWriter>>();  // userId → all SSE connections
const memoryRecords = new Map<string, MemoryState>();  // userId → in-memory record (skipPersistence mode)

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

// ─── DB Operations ──────────────────────────────────────────────────────────

async function loadState(supabase: SupabaseClient, userId: string): Promise<{ phase: Phase; pendingQuestion: QuestionInput | null }> {
  const { data } = await supabase
    .from('machine_config_state')
    .select('phase, pending_question')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return { phase: 'idle', pendingQuestion: null };
  return { phase: data.phase as Phase, pendingQuestion: data.pending_question as QuestionInput | null };
}

async function loadMessages(supabase: SupabaseClient, userId: string): Promise<StoredMessage[]> {
  const { data } = await supabase
    .from('machine_config_messages')
    .select('id, role, content, content_blocks, ordinal')
    .eq('user_id', userId)
    .order('ordinal', { ascending: true });

  if (!data) return [];
  return data.map((row) => {
    const base = { id: row.id };
    if (row.role === 'cancel') {
      return { ...base, role: 'cancel' as const, content: row.content };
    }
    if (row.role === 'assistant') {
      // Reconstruct ContentBlock[] from content_blocks, falling back to text
      const blocks: Anthropic.ContentBlock[] = row.content_blocks
        ? (row.content_blocks as Anthropic.ContentBlock[])
        : [{ type: 'text', text: row.content, citations: [] } as Anthropic.ContentBlock];
      return { ...base, role: 'assistant' as const, content: blocks };
    }
    // user — either plain text or tool results
    if (row.content_blocks && Array.isArray(row.content_blocks) &&
        row.content_blocks.length > 0 && (row.content_blocks[0] as any)?.type === 'tool_result') {
      return { ...base, role: 'user' as const, content: row.content_blocks as Anthropic.ToolResultBlockParam[] };
    }
    return { ...base, role: 'user' as const, content: row.content };
  });
}

async function upsertState(supabase: SupabaseClient, userId: string, phase: Phase, pendingQuestion: QuestionInput | null): Promise<void> {
  await supabase
    .from('machine_config_state')
    .upsert({
      user_id: userId,
      phase,
      pending_question: pendingQuestion,
    }, { onConflict: 'user_id' });
}

async function appendMessage(
  supabase: SupabaseClient,
  userId: string,
  role: string,
  content: string,
  contentBlocks: unknown | null,
  ordinal: number,
): Promise<string> {
  const { data } = await supabase
    .from('machine_config_messages')
    .insert({
      user_id: userId,
      role,
      content,
      content_blocks: contentBlocks,
      ordinal,
    })
    .select('id')
    .single();

  return data?.id ?? '';
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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
  const CHAR_LIMIT = 32768;
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

/** Extract display text from a StoredMessage */
const extractDisplayText = (msg: StoredMessage): string => {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return (msg.content as any[])
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text as string)
      .join('\n\n');
  }
  return '';
};

// ─── Persistence Adapter ────────────────────────────────────────────────────

interface PersistenceAdapter {
  setPhase(phase: Phase, pendingQuestion?: QuestionInput | null): Promise<void>;
  appendMsg(msg: StoredMessage): Promise<void>;
}

function createDbAdapter(
  supabase: SupabaseClient,
  userId: string,
  ordinalRef: { value: number },
): PersistenceAdapter {
  return {
    async setPhase(phase, pendingQuestion) {
      await upsertState(supabase, userId, phase, pendingQuestion ?? null);
    },
    async appendMsg(msg) {
      const ordinal = ordinalRef.value++;
      const displayText = extractDisplayText(msg);
      const contentBlocks = typeof msg.content === 'string' ? null : msg.content;
      const id = await appendMessage(supabase, userId, msg.role, displayText, contentBlocks, ordinal);
      msg.id = id;
    },
  };
}

function createMemoryAdapter(userId: string, messages: StoredMessage[]): PersistenceAdapter {
  return {
    async setPhase(phase, pendingQuestion) {
      let rec = memoryRecords.get(userId);
      if (!rec) {
        rec = { phase: 'idle', pendingQuestion: null, messages };
        memoryRecords.set(userId, rec);
      }
      rec.phase = phase;
      rec.pendingQuestion = pendingQuestion ?? null;
      rec.messages = messages;
    },
    async appendMsg(msg) {
      messages.push(msg);
      const rec = memoryRecords.get(userId);
      if (rec) rec.messages = messages;
    },
  };
}

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
  let phase: Phase = 'idle';
  let pendingQuestion: QuestionInput | null = null;
  let messages: StoredMessage[] = [];
  let customerToken: string | null = null;
  let configSchema: string | undefined;

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

  // Config schema, current config, and conversation record in parallel
  const authHeaders = { Authorization: `Bearer ${customerToken}`, Accept: 'application/json' };

  const schemaPromise = fetch(`${config.macMgmtUrl}/api/setting/config/schema`, {
    headers: authHeaders,
  }).then((res) => res.ok ? res.text() : undefined).catch(() => undefined);

  const configPromise = fetch(`${config.macMgmtUrl}/api/setting/config`, {
    headers: authHeaders,
  }).then((res) => res.ok ? res.text() : undefined).catch(() => undefined);

  const recordPromise = (async () => {
    if (config.skipPersistence) {
      const rec = memoryRecords.get(userId);
      return rec ? { phase: rec.phase, pendingQuestion: rec.pendingQuestion, messages: rec.messages } : null;
    }
    if (supabase) {
      const [state, msgs] = await Promise.all([
        loadState(supabase, userId),
        loadMessages(supabase, userId),
      ]);
      return { phase: state.phase, pendingQuestion: state.pendingQuestion, messages: msgs };
    }
    return null;
  })();

  const [schema, currentConfig, loadedRecord] = await Promise.all([schemaPromise, configPromise, recordPromise]);
  configSchema = schema;
  if (loadedRecord) {
    phase = loadedRecord.phase;
    pendingQuestion = loadedRecord.pendingQuestion;
    messages = loadedRecord.messages;
  }

  console.log(`[chat] Loaded: ${messages.length} msgs, phase=${phase}`);

  // ── Ordinal tracking ──────────────────────────────────────────────────────
  const ordinalRef = { value: messages.length };

  // ── Persistence adapter ───────────────────────────────────────────────────
  const adapter: PersistenceAdapter = (config.skipPersistence || !supabase)
    ? createMemoryAdapter(userId, messages)
    : createDbAdapter(supabase, userId, ordinalRef);

  const setPhase = async (p: Phase, pq?: QuestionInput | null) => {
    phase = p;
    pendingQuestion = pq ?? null;
    await adapter.setPhase(p, pq);
  };

  const appendMsg = async (msg: StoredMessage) => {
    messages.push(msg);
    await adapter.appendMsg(msg);
  };

  // ── Handle incoming message based on type and current phase ────────────────

  if (body.type === 'answer') {
    // Answer to a pending question — resume from waiting_for_answer
    if (phase !== 'waiting_for_answer') {
      broadcast(userId, 'error', { type: 'error', message: 'No pending question to answer' });
      return;
    }

    const answer = body.text;
    const cancelled = answer === '__cancel__';

    const toolUseBlocks = getLastToolUseBlocks(messages);
    if (!toolUseBlocks) {
      broadcast(userId, 'error', { type: 'error', message: 'Resume error: no tool_use blocks found' });
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
      broadcast(userId, 'error', { type: 'error', message: 'A conversation turn is already in progress' });
      return;
    }

    await appendMsg({ role: 'user', content: body.text });
    await setPhase('idle');
  } else {
    broadcast(userId, 'error', { type: 'error', message: `Unknown message type: ${body.type}` });
    return;
  }

  // ── Run the tool loop ─────────────────────────────────────────────────────

  await runToolLoop(userId, config, messages, phase, customerToken!, locale, configSchema, currentConfig, setPhase, appendMsg);
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
  messages: StoredMessage[],
  phase: Phase,
  customerToken: string,
  locale: string,
  configSchema: string | undefined,
  currentConfig: string | undefined,
  setPhase: (phase: Phase, pendingQuestion?: QuestionInput | null) => Promise<void>,
  appendMsg: (msg: StoredMessage) => Promise<void>,
): Promise<void> {
  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  const systemPrompt = buildSystemPrompt(locale, configSchema);
  const tools = buildToolDefinitions();

  // ── Pre-step: resume from tool_pending ──────────────────────────────────

  if (phase === 'tool_pending') {
    broadcast(userId, 'thinking', { type: 'thinking' });

    const toolUseBlocks = getLastToolUseBlocks(messages);
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

    await appendMsg({ role: 'user', content: toolResults });
    await setPhase('idle');
  }

  // ── Main loop ─────────────────────────────────────────────────────────────

  const MAX_TOOL_ROUNDS = 10;
  let rounds = 0;

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    const trimmed = trimMessages(messages.filter((m) => m.role !== 'cancel'));
    const claudeMessages = sanitizeMessages(toClaudeMessages(trimmed));

    // Inject current config as a hidden message (not stored, always re-inserted)
    if (currentConfig && claudeMessages.length > 0 && claudeMessages[0].role === 'user') {
      const configNote = `[Current machine configuration]\n\`\`\`toml\n${currentConfig}\n\`\`\``;
      const first = claudeMessages[0];
      if (typeof first.content === 'string') {
        first.content = configNote + '\n\n' + first.content;
      } else {
        (first.content as Anthropic.ContentBlockParam[]).unshift({ type: 'text' as const, text: configNote });
      }
    }

    console.log(`[chat] Round ${rounds}/${MAX_TOOL_ROUNDS}, ${claudeMessages.length} msgs`);

    broadcast(userId, 'thinking', { type: 'thinking' });

    // ── Real streaming via messages.stream() ────────────────────────────────

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: systemPrompt,
      tools,
      messages: claudeMessages,
    });

    stream.on('text', (delta) => {
      broadcast(userId, 'text_delta', { type: 'text_delta', content: delta });
    });

    const response = await stream.finalMessage();

    const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use') as Anthropic.ToolUseBlock[];
    const textBlocks = response.content.filter((b) => b.type === 'text') as Anthropic.TextBlock[];
    console.log(`[chat] stop=${response.stop_reason}, ${toolUseBlocks.length} tools, ${textBlocks.length} text`);

    // Send text_done for each text block (full text for client to finalize)
    for (const block of textBlocks) {
      if (block.text) broadcast(userId, 'text_done', { type: 'text_done', content: block.text });
    }

    // ── Final response (no tools or end_turn) ──────────────────────────────
    if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
      const safeContent = response.content.filter((b) => b.type !== 'tool_use');
      if (safeContent.length > 0) {
        await appendMsg({ role: 'assistant', content: safeContent });
      }
      await setPhase('idle');
      broadcast(userId, 'done', { type: 'done' });
      return;
    }

    // Store full assistant response (tool_use blocks included)
    await appendMsg({ role: 'assistant', content: response.content });

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

    await appendMsg({ role: 'user', content: toolResults });
    await setPhase('idle');
  }

  // Safety: max rounds
  const msg = "I've been working on your request but it required too many steps. Could you try a more specific request?";
  await appendMsg({
    role: 'assistant',
    content: [{ type: 'text', text: msg, citations: [] }] as Anthropic.ContentBlock[],
  });
  await setPhase('idle');
  broadcast(userId, 'text_done', { type: 'text_done', content: msg });
  broadcast(userId, 'done', { type: 'done' });
}
