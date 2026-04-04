/**
 * Client-side tools — intercepted on the server, no API endpoint.
 */

import { createClient } from '@supabase/supabase-js';
import { DOC_IDS } from '../content';
import type { ToolDef } from './registry';

// ─── Client-Side Tools (no endpoint — intercepted on the server) ────────────

export const ASK_QUESTION_TOOL: ToolDef = {
  name: 'ask_question',
  description:
    'Ask the user a structured question. Use "multiple_choice" for picking from options, "text" for free-form input.',
  input_schema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['multiple_choice', 'text'],
        description: 'Question type.',
      },
      question: { type: 'string', description: 'The question text.' },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Options for multiple_choice. Omit for text.',
      },
    },
    required: ['type', 'question'],
  },
};

export const PROMPT_PREFERENCE_TOOL: ToolDef = {
  name: 'prompt_preference',
  description:
    'Prompt the user about a preference (e.g. newsletter subscription). The client renders the question and Yes/No buttons. Returns "subscribed" or "declined".',
  input_schema: {
    type: 'object',
    properties: {
      preference_id: {
        type: 'string',
        enum: ['newsletter'],
        description: 'Which preference to prompt for.',
      },
    },
    required: ['preference_id'],
  },
};

export const GET_PRODUCT_INFO_TOOL: ToolDef = {
  name: 'get_product_info',
  description:
    'Retrieve product documentation about plan.ai. Use this to answer questions about the product, its features, architecture, use cases, pricing, or how to get started. Always call this tool before answering product-related questions.',
  input_schema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        enum: DOC_IDS,
        description: 'The documentation topic to retrieve.',
      },
    },
    required: ['topic'],
  },
};

export const UPDATE_CONFIG_TOOL: ToolDef = {
  name: 'update_config',
  description:
    'Update a single field in the TOML configuration. Atomically reads the current config, sets the field under the given section, and saves it back. Use this instead of get_config + set_config when you need to change individual fields.',
  input_schema: {
    type: 'object',
    properties: {
      section: { type: 'string', description: 'The TOML section name (e.g. "global").' },
      key: { type: 'string', description: 'The key to set within the section.' },
      value: { type: 'string', description: 'The value to set.' },
    },
    required: ['section', 'key', 'value'],
  },
};

export const SEND_STAFF_PING_TOOL: ToolDef = {
  name: 'send_staff_ping',
  description:
    'Send an internal notification to staff. Use when the user wants to schedule a demo, requests a callback, or needs human follow-up. The user will NOT see this message.',
  input_schema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        enum: ['demo_request', 'callback_request', 'support_escalation', 'other'],
        description: 'Category of the ping.',
      },
      message: {
        type: 'string',
        description: 'Concise message for staff describing what action is needed and relevant context.',
      },
    },
    required: ['reason', 'message'],
  },
};

/** Insert a staff ping using a service-role Supabase client. */
export async function executeStaffPing(
  input: Record<string, unknown>,
  userId: string,
  supabaseUrl: string,
  supabaseServiceKey: string,
): Promise<string> {
  const { reason, message } = input as { reason: string; message: string };
  try {
    const sb = createClient(supabaseUrl, supabaseServiceKey);
    const { error } = await sb
      .from('staff_pings')
      .insert({ user_id: userId, reason, message });
    if (error) return JSON.stringify({ error: error.message });
    return JSON.stringify({ success: true });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}

export const CLIENT_SIDE_TOOLS = new Set(['ask_question', 'prompt_preference']);

/** Returns true if the tool is handled client-side (no API call). */
export const isClientSideTool = (name: string): boolean =>
  CLIENT_SIDE_TOOLS.has(name);
