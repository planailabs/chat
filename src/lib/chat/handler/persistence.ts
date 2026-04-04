/**
 * Persistence layer — DB operations and in-memory adapters.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';

// ─── Types ──────────────────────────────────────────────────────────────────

export type Phase = 'idle' | 'waiting_for_answer' | 'tool_pending';

export type StoredMessage =
  | { id?: string; role: 'user'; content: string }
  | { id?: string; role: 'assistant'; content: Anthropic.ContentBlock[] }
  | { id?: string; role: 'user'; content: Anthropic.ToolResultBlockParam[] }
  | { id?: string; role: 'cancel'; content: string };

export interface ClientToolPrompt {
  toolName: string;
  input: Record<string, unknown>;
}

/** In-memory state for skipPersistence mode */
export interface MemoryState {
  phase: Phase;
  pendingQuestion: ClientToolPrompt | null;
  messages: StoredMessage[];
}

// ─── In-memory records (skipPersistence mode) ────────────────────────────────

export const memoryRecords = new Map<string, MemoryState>();

// ─── Persistence Adapter ────────────────────────────────────────────────────

export interface PersistenceAdapter {
  setPhase(phase: Phase, pendingQuestion?: ClientToolPrompt | null): Promise<void>;
  appendMsg(msg: StoredMessage): Promise<void>;
}

// ─── DB Operations ──────────────────────────────────────────────────────────

export async function loadState(
  supabase: SupabaseClient,
  userId: string,
  stateTable: string,
  modeColumn: string,
): Promise<{ phase: Phase; pendingQuestion: ClientToolPrompt | null }> {
  const { data } = await supabase
    .from(stateTable)
    .select('phase, pending_question')
    .eq('user_id', userId)
    .eq('mode', modeColumn)
    .maybeSingle();

  if (!data) return { phase: 'idle', pendingQuestion: null };
  return { phase: data.phase as Phase, pendingQuestion: data.pending_question as ClientToolPrompt | null };
}

export async function loadMessages(
  supabase: SupabaseClient,
  userId: string,
  messagesTable: string,
  modeColumn: string,
): Promise<StoredMessage[]> {
  const { data } = await supabase
    .from(messagesTable)
    .select('id, role, content, content_blocks, ordinal')
    .eq('user_id', userId)
    .eq('mode', modeColumn)
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

export async function upsertState(
  supabase: SupabaseClient,
  userId: string,
  phase: Phase,
  pendingQuestion: ClientToolPrompt | null,
  stateTable: string,
  modeColumn: string,
): Promise<void> {
  await supabase.from(stateTable).upsert({
    user_id: userId,
    mode: modeColumn,
    phase,
    pending_question: pendingQuestion,
  }, { onConflict: 'user_id,mode' });
}

export async function appendMessage(
  supabase: SupabaseClient,
  userId: string,
  role: string,
  content: string,
  contentBlocks: unknown | null,
  ordinal: number,
  messagesTable: string,
  modeColumn: string,
): Promise<string> {
  const { data } = await supabase
    .from(messagesTable)
    .insert({
      user_id: userId,
      mode: modeColumn,
      role,
      content,
      content_blocks: contentBlocks,
      ordinal,
    })
    .select('id')
    .single();

  return data?.id ?? '';
}

// ─── Display Text Extraction ────────────────────────────────────────────────

/** Extract display text from a StoredMessage */
export const extractDisplayText = (msg: StoredMessage): string => {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return (msg.content as any[])
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text as string)
      .join('\n\n');
  }
  return '';
};

// ─── Adapter Factories ──────────────────────────────────────────────────────

export function createDbAdapter(
  supabase: SupabaseClient,
  userId: string,
  messages: StoredMessage[],
  ordinalRef: { value: number },
  stateTable: string,
  messagesTable: string,
  modeColumn: string,
): PersistenceAdapter {
  return {
    async setPhase(phase, pendingQuestion) {
      await upsertState(supabase, userId, phase, pendingQuestion ?? null, stateTable, modeColumn);
    },
    async appendMsg(msg) {
      messages.push(msg);
      const ordinal = ordinalRef.value++;
      const displayText = extractDisplayText(msg);
      const contentBlocks = typeof msg.content === 'string' ? null : msg.content;
      const id = await appendMessage(supabase, userId, msg.role, displayText, contentBlocks, ordinal, messagesTable, modeColumn);
      msg.id = id;
    },
  };
}

export function createMemoryAdapter(key: string, messages: StoredMessage[]): PersistenceAdapter {
  return {
    async setPhase(phase, pendingQuestion) {
      let rec = memoryRecords.get(key);
      if (!rec) {
        rec = { phase: 'idle', pendingQuestion: null, messages };
        memoryRecords.set(key, rec);
      }
      rec.phase = phase;
      rec.pendingQuestion = pendingQuestion ?? null;
      rec.messages = messages;
    },
    async appendMsg(msg) {
      messages.push(msg);
      const rec = memoryRecords.get(key);
      if (rec) rec.messages = messages;
    },
  };
}
