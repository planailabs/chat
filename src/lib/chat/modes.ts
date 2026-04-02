/**
 * Chat Mode Abstraction
 *
 * Generic interface for chat modes. Each mode defines its own prompt,
 * tools, DB tables, and optional setup/context-injection hooks.
 * The handler calls these hooks without knowing what any mode does internally.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatConfig } from './handler';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ChatModeId = 'machine_config' | 'sales' | 'newsletter_signup';

/** Opaque per-mode context returned by prepare() and passed to executeTool()/injectContext() */
export interface ModeContext {
  [key: string]: unknown;
}

export interface ChatModeConfig {
  id: ChatModeId;
  stateTable: string;
  messagesTable: string;
  /** Mode column value used in shared chat_state/chat_messages tables */
  modeColumn: string;
  /** Build system prompt. Called each turn — `extraContext` comes from `prepare()`. */
  buildSystemPrompt: (locale: string, extraContext?: Record<string, string>) => string;
  /** Tool definitions for Claude */
  buildToolDefinitions: () => Anthropic.Tool[];
  /** Execute a server-side tool. Null if mode has no server-side tools. */
  executeTool: ((name: string, input: Record<string, unknown>, context: ModeContext) => Promise<string>) | null;
  /** Max characters for the composer input */
  maxChars: number;
  /** Claude model to use */
  model: string;
  /** Max tokens for Claude response */
  maxTokens: number;
  /**
   * Mode-specific setup hook. Runs once per turn before the tool loop.
   * Returns extra context (e.g. machine config fetches its TOML schema + current config).
   * Generic modes return empty or null.
   */
  prepare?: (userId: string, config: ChatConfig, supabase: SupabaseClient | null) => Promise<ModeContext | null>;
  /**
   * Optional hook to inject context into Claude messages before each round.
   * Machine config uses this to prepend current TOML config to the first message.
   * Other modes don't need it.
   */
  injectContext?: (messages: Anthropic.MessageParam[], context: ModeContext) => void;
}

// ─── Registry ───────────────────────────────────────────────────────────────

const registry = new Map<ChatModeId, ChatModeConfig>();

export function registerChatMode(mode: ChatModeConfig): void {
  registry.set(mode.id, mode);
}

export function getChatModeConfig(id: ChatModeId): ChatModeConfig | undefined {
  return registry.get(id);
}

export function getAllChatModes(): ChatModeConfig[] {
  return Array.from(registry.values());
}
