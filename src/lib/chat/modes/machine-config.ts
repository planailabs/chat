/**
 * Machine Config Chat Mode
 *
 * Manages mac-mgmt configuration via Claude. Owns:
 * - prepare(): fetches customer token, config schema, current config
 * - injectContext(): prepends TOML config to first user message
 * - buildSystemPrompt(): wraps existing prompt builder
 * - buildToolDefinitions() / executeTool(): from tools.ts
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { registerChatMode, type ChatModeConfig, type ModeContext } from '../modes';
import type { ChatConfig } from '../handler';
import { buildSystemPrompt } from '../prompt';
import { buildToolDefinitions, executeTool } from '../tools';
import type Anthropic from '@anthropic-ai/sdk';

export const machineConfigMode: ChatModeConfig = {
  id: 'machine_config',
  stateTable: 'chat_state',
  messagesTable: 'chat_messages',
  modeColumn: 'machine_config',
  maxChars: 1024,
  model: 'claude-sonnet-4-20250514',
  maxTokens: 2048,

  buildSystemPrompt(locale: string, extraContext?: Record<string, string>): string {
    return buildSystemPrompt(locale, extraContext?.configSchema);
  },

  buildToolDefinitions(): Anthropic.Tool[] {
    return buildToolDefinitions();
  },

  executeTool: async (name: string, input: Record<string, unknown>, context: ModeContext): Promise<string> => {
    const customerToken = context.customerToken as string;
    const macMgmtUrl = context.macMgmtUrl as string;
    return executeTool(name, input, customerToken, macMgmtUrl);
  },

  async prepare(userId: string, config: ChatConfig, supabase: SupabaseClient | null): Promise<ModeContext | null> {
    // Resolve customer token
    let customerToken: string | null = null;

    if (config.customerToken) {
      customerToken = config.customerToken;
    } else if (supabase) {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('customer_token')
        .eq('user_id', userId)
        .maybeSingle();

      if (profileError || !profile?.customer_token) {
        console.warn('[chat] No customer token for user', userId, profileError?.message);
        return null; // Signal: cannot proceed
      }
      customerToken = profile.customer_token as string;
    } else {
      return null;
    }

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
    };
  },

  injectContext(messages: Anthropic.MessageParam[], context: ModeContext): void {
    const currentConfig = context.currentConfig as string | undefined;
    if (!currentConfig || messages.length === 0 || messages[0].role !== 'user') return;

    const configNote = `[Current machine configuration]\n\`\`\`toml\n${currentConfig}\n\`\`\``;
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
