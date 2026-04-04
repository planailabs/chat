/**
 * Message utilities — conversion, sanitization, trimming, caching.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { StoredMessage } from './persistence';

// ─── Conversion ─────────────────────────────────────────────────────────────

/**
 * Convert StoredMessage[] -> Claude MessageParam[], merging consecutive
 * same-role messages.
 */
export const toClaudeMessages = (msgs: StoredMessage[]): Anthropic.MessageParam[] => {
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
        : JSON.parse(JSON.stringify(m.content)) as Anthropic.ContentBlockParam[];
      const merged = [...prevArr, ...curArr];
      const toolResults = merged.filter((b) => (b as any).type === 'tool_result');
      const rest = merged.filter((b) => (b as any).type !== 'tool_result');
      prev.content = [...toolResults, ...rest];
      continue;
    }

    if (role === 'user') {
      // Deep-clone user content to prevent cache_control from leaking back
      // into the stored messages array when addConversationCacheBreakpoint mutates it.
      const cloned = typeof m.content === 'string'
        ? m.content
        : JSON.parse(JSON.stringify(m.content));
      result.push({ role, content: cloned });
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

// ─── Sanitization ───────────────────────────────────────────────────────────

/**
 * Sanitize Claude messages: strip tool_use blocks that don't have matching
 * tool_result blocks in the immediately following message.
 */
export const sanitizeMessages = (msgs: Anthropic.MessageParam[]): Anthropic.MessageParam[] => {
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

// ─── Size helpers ───────────────────────────────────────────────────────────

export const contentSize = (msg: StoredMessage): number =>
  typeof msg.content === 'string' ? msg.content.length : JSON.stringify(msg.content).length;

export const isToolResultMsg = (msg: StoredMessage): boolean =>
  msg.role === 'user' && Array.isArray(msg.content) &&
  msg.content.length > 0 && (msg.content[0] as any)?.type === 'tool_result';

export const hasToolUse = (msg: StoredMessage): boolean =>
  msg.role === 'assistant' && Array.isArray(msg.content) &&
  (msg.content as any[]).some((b) => b.type === 'tool_use');

// ─── Trimming ───────────────────────────────────────────────────────────────

export const trimMessages = (msgs: StoredMessage[]): StoredMessage[] => {
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

// ─── Tool block helpers ─────────────────────────────────────────────────────

export const getLastToolUseBlocks = (messages: StoredMessage[]): Anthropic.ToolUseBlock[] | null => {
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

// ─── Prompt Caching ─────────────────────────────────────────────────────────

/**
 * Add a cache breakpoint on the second-to-last user message so that the
 * entire conversation history except the latest turn is cached.
 */
export function addConversationCacheBreakpoint(msgs: Anthropic.MessageParam[]): void {
  let userCount = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'user') {
      userCount++;
      if (userCount === 2) {
        const msg = msgs[i];
        if (typeof msg.content === 'string') {
          msg.content = [{ type: 'text', text: msg.content, cache_control: { type: 'ephemeral' } } as any];
        } else if (Array.isArray(msg.content) && msg.content.length > 0) {
          (msg.content[msg.content.length - 1] as any).cache_control = { type: 'ephemeral' };
        }
        break;
      }
    }
  }
}
