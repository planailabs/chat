/**
 * Tool loop — multi-round tool execution with streaming.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isClientSideTool } from '../tools';
import type { ChatModeConfig, ModeContext } from '../modes';
import type { ChatConfig } from './index';
import type { Phase, StoredMessage, ClientToolPrompt } from './persistence';
import { broadcast } from './index';
import { trimMessages, sanitizeMessages, toClaudeMessages, addConversationCacheBreakpoint, getLastToolUseBlocks } from './messageUtils';
import { recordTokenUsage } from './tokenBudget';

// ─── Question Tool Results ──────────────────────────────────────────────────

export const buildQuestionToolResults = (
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

export async function runToolLoop(
  userId: string,
  config: ChatConfig,
  messages: StoredMessage[],
  phase: Phase,
  mode: ChatModeConfig,
  modeContext: ModeContext,
  locale: string,
  connKey: string,
  setPhase: (phase: Phase, pendingQuestion?: ClientToolPrompt | null) => Promise<void>,
  appendMsg: (msg: StoredMessage) => Promise<void>,
  supabase: SupabaseClient | null,
): Promise<void> {
  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  const extraContext: Record<string, string> = {};
  for (const [k, v] of Object.entries(modeContext)) {
    if (typeof v === 'string') extraContext[k] = v;
  }
  const systemPrompt = mode.buildSystemPrompt(locale, extraContext);
  const tools = mode.buildToolDefinitions();

  // Cache breakpoint on system prompt
  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } } as any,
  ];

  // Cache breakpoint on last tool definition
  if (tools.length > 0) {
    tools[tools.length - 1] = {
      ...tools[tools.length - 1],
      cache_control: { type: 'ephemeral' },
    } as any;
  }

  // Token usage accumulator
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheCreationInputTokens = 0;
  let totalCacheReadInputTokens = 0;

  // ── Pre-step: resume from tool_pending ──────────────────────────────────

  if (phase === 'tool_pending') {
    broadcast(connKey, 'thinking', { type: 'thinking' });

    const toolUseBlocks = getLastToolUseBlocks(messages);
    if (!toolUseBlocks) throw new Error('Resume error: no tool_use blocks found');

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      if (isClientSideTool(block.name)) continue;

      broadcast(connKey, 'tool_start', { type: 'tool_start', name: block.name });
      const result = mode.executeTool
        ? await mode.executeTool(block.name, (block.input ?? {}) as Record<string, unknown>, modeContext)
        : JSON.stringify({ error: `No tool executor for mode ${mode.id}` });
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
      broadcast(connKey, 'tool_end', { type: 'tool_end', name: block.name });
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

    // Mode-specific context injection (e.g. machine config prepends TOML)
    if (mode.injectContext) {
      mode.injectContext(claudeMessages, modeContext);
    }

    // Cache breakpoint on conversation history prefix
    addConversationCacheBreakpoint(claudeMessages);

    console.log(`[chat] Round ${rounds}/${MAX_TOOL_ROUNDS}, ${claudeMessages.length} msgs`);

    broadcast(connKey, 'thinking', { type: 'thinking' });

    // ── Real streaming via messages.stream() ────────────────────────────────

    const stream = anthropic.messages.stream({
      model: mode.model,
      max_tokens: mode.maxTokens,
      system: systemBlocks as any,
      tools,
      messages: claudeMessages,
    });

    stream.on('text', (delta) => {
      broadcast(connKey, 'text_delta', { type: 'text_delta', content: delta });
    });

    const response = await stream.finalMessage();

    // Accumulate token usage
    if (response.usage) {
      totalInputTokens += response.usage.input_tokens ?? 0;
      totalOutputTokens += response.usage.output_tokens ?? 0;
      totalCacheCreationInputTokens += (response.usage as any).cache_creation_input_tokens ?? 0;
      totalCacheReadInputTokens += (response.usage as any).cache_read_input_tokens ?? 0;
    }

    const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use') as Anthropic.ToolUseBlock[];
    const textBlocks = response.content.filter((b) => b.type === 'text') as Anthropic.TextBlock[];
    console.log(`[chat] stop=${response.stop_reason}, ${toolUseBlocks.length} tools, ${textBlocks.length} text`);

    // Send text_done for each text block (full text for client to finalize)
    for (const block of textBlocks) {
      if (block.text) broadcast(connKey, 'text_done', { type: 'text_done', content: block.text });
    }

    // ── Final response (no tools or end_turn) ──────────────────────────────
    if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
      const safeContent = response.content.filter((b) => b.type !== 'tool_use');
      if (safeContent.length > 0) {
        await appendMsg({ role: 'assistant', content: safeContent });
      }
      await setPhase('idle');
      broadcast(connKey, 'done', { type: 'done' });
      break;
    }

    // Store full assistant response (tool_use blocks included)
    await appendMsg({ role: 'assistant', content: response.content });

    // ── ask_question ────────────────────────────────────────────────────────
    const clientToolBlock = toolUseBlocks.find((b) => isClientSideTool(b.name));

    if (clientToolBlock) {
      rounds--;

      const clientPrompt: ClientToolPrompt = {
        toolName: clientToolBlock.name,
        input: (clientToolBlock.input ?? {}) as Record<string, unknown>,
      };

      // Persist phase BEFORE sending question — resumable checkpoint
      await setPhase('waiting_for_answer', clientPrompt);
      broadcast(connKey, 'question', { type: 'question', toolName: clientToolBlock.name, input: clientPrompt.input });

      // Return — the next POST will resume with an answer
      // Record tokens before returning
      if (supabase && (totalInputTokens > 0 || totalOutputTokens > 0)) {
        await recordTokenUsage(supabase, userId, mode.id, totalInputTokens, totalOutputTokens, totalCacheCreationInputTokens, totalCacheReadInputTokens);
      }
      return;
    }

    // ── API tools ───────────────────────────────────────────────────────────
    await setPhase('tool_pending');

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      broadcast(connKey, 'tool_start', { type: 'tool_start', name: block.name });
      const result = mode.executeTool
        ? await mode.executeTool(block.name, (block.input ?? {}) as Record<string, unknown>, modeContext)
        : JSON.stringify({ error: `No tool executor for mode ${mode.id}` });
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
      broadcast(connKey, 'tool_end', { type: 'tool_end', name: block.name });
    }

    await appendMsg({ role: 'user', content: toolResults });
    await setPhase('idle');
  }

  // Safety: max rounds
  if (rounds >= MAX_TOOL_ROUNDS) {
    const msg = "I've been working on your request but it required too many steps. Could you try a more specific request?";
    await appendMsg({
      role: 'assistant',
      content: [{ type: 'text', text: msg, citations: [] }] as Anthropic.ContentBlock[],
    });
    await setPhase('idle');
    broadcast(connKey, 'text_done', { type: 'text_done', content: msg });
    broadcast(connKey, 'done', { type: 'done' });
  }

  // Record accumulated token usage after loop completes
  if (supabase && (totalInputTokens > 0 || totalOutputTokens > 0)) {
    await recordTokenUsage(supabase, userId, mode.id, totalInputTokens, totalOutputTokens, totalCacheCreationInputTokens, totalCacheReadInputTokens);
  }
}
