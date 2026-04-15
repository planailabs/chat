/**
 * Machine Config Chat Mode
 *
 * Manages mac-mgmt configuration via Claude. Owns:
 * - prepare(): fetches customer token, config schema, current config
 * - injectContext(): prepends JSON config to first user message
 * - buildSystemPrompt(): wraps existing prompt builder
 * - buildToolDefinitions() / executeTool(): from tools.ts
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { registerChatMode, fetchUserProfile, injectUserProfile, type ChatModeConfig, type ModeContext } from '../modes';
import type { ChatConfig } from '../handler';
import { buildSystemPrompt } from '../prompt';
import { buildToolDefinitions, executeTool, PROMPT_PREFERENCE_TOOL, SEND_STAFF_PING_TOOL, executeStaffPing } from '../tools';
import type Anthropic from '@anthropic-ai/sdk';

export const machineConfigMode: ChatModeConfig = {
  id: 'machine_config',
  stateTable: 'chat_state',
  messagesTable: 'chat_messages',
  modeColumn: 'machine_config',
  maxChars: 1024,
  model: 'claude-sonnet-4-5',
  maxTokens: 2048,

  buildSystemPrompt(locale: string, extraContext?: Record<string, string>): string {
    return buildSystemPrompt(locale, extraContext?.configSchema);
  },

  buildToolDefinitions(): Anthropic.Tool[] {
    return [...buildToolDefinitions(), PROMPT_PREFERENCE_TOOL, SEND_STAFF_PING_TOOL];
  },

  executeTool: async (name: string, input: Record<string, unknown>, context: ModeContext): Promise<string> => {
    if (name === 'send_staff_ping') {
      return executeStaffPing(input, context.userId as string, context.supabaseUrl as string, context.supabaseServiceKey as string);
    }
    const customerToken = context.customerToken as string;
    const macMgmtUrl = context.macMgmtUrl as string;
    return executeTool(name, input, customerToken, macMgmtUrl);
  },

  async prepare(userId: string, config: ChatConfig, supabase: SupabaseClient | null): Promise<ModeContext | null> {
    if (!supabase && !config.customerToken) return null;

    // Fetch profile (for user context + customer token)
    const userProfile = supabase ? await fetchUserProfile(supabase, userId) : undefined;

    // Resolve customer token
    let customerToken: string | null = config.customerToken ?? null;
    if (!customerToken && supabase) {
      const { data } = await supabase
        .from('profiles')
        .select('customer_token')
        .eq('user_id', userId)
        .maybeSingle();

      if (!data?.customer_token) {
        console.warn('[chat] No customer token for user', userId);
        return null;
      }
      customerToken = data.customer_token as string;
    }
    if (!customerToken) return null;

    // Fetch config schema and current config in parallel
    const authHeaders = { Authorization: `Bearer ${customerToken}`, Accept: 'application/json' };

    const [schema, currentConfig] = await Promise.all([
      fetch(`${config.macMgmtUrl}/api/setting/config/schema`, { headers: authHeaders })
        .then((res) => res.ok ? res.text() : undefined)
        .catch(() => undefined),
      fetch(`${config.macMgmtUrl}/api/setting/config`, { headers: authHeaders })
        .then((res) => res.ok ? res.text() : undefined)
        .catch(() => undefined),
    ]);

    return {
      customerToken,
      macMgmtUrl: config.macMgmtUrl,
      configSchema: schema,
      currentConfig,
      userProfile,
      userId,
      supabaseUrl: config.supabaseUrl,
      supabaseServiceKey: config.supabaseServiceKey,
    };
  },

  injectContext(messages: Anthropic.MessageParam[], context: ModeContext): void {
    // Inject user profile first (appears before config in the first message)
    injectUserProfile(messages, context.userProfile as any);

    const currentConfig = context.currentConfig as string | undefined;
    if (!currentConfig || messages.length === 0 || messages[0].role !== 'user') return;

    const configNote = `[Current machine configuration]\n\`\`\`json\n${currentConfig}\n\`\`\``;
    const first = messages[0];
    if (typeof first.content === 'string') {
      first.content = configNote + '\n\n' + first.content;
    } else {
      (first.content as Anthropic.ContentBlockParam[]).unshift({ type: 'text' as const, text: configNote });
    }
  },
};

// Self-register
registerChatMode(machineConfigMode);
