/**
 * Sales Chat Mode
 *
 * Conversational mode for sales inquiries.
 * Tools: ask_question, prompt_preference, get_product_info, get_catalog.
 */

import ISO6391 from 'iso-639-1';
import type { SupabaseClient } from '@supabase/supabase-js';
import { registerChatMode, fetchUserProfile, injectUserProfile, type ChatModeConfig, type ModeContext } from '../modes';
import type { ChatConfig } from '../handler';
import { ASK_QUESTION_TOOL, PROMPT_PREFERENCE_TOOL, GET_PRODUCT_INFO_TOOL } from '../tools';
import { lookupProductDoc, DOC_IDS } from '../content';
import type Anthropic from '@anthropic-ai/sdk';

// ─── Catalog helpers ─────────────────────────────────────────────────────────

/** Recursively strip keys starting with "installed" from any value. */
const stripInstalled = (val: unknown): unknown => {
  if (Array.isArray(val)) return val.map(stripInstalled);
  if (val !== null && typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (k.startsWith('installed')) continue;
      out[k] = stripInstalled(v);
    }
    return out;
  }
  return val;
};

const CATALOG_ENDPOINTS: Record<string, string> = {
  catalog: '/api/setting/catalog',
  available_skills: '/api/setting/available/skill-channels',
  available_bundles: '/api/setting/available/bundles',
  available_mcp_servers: '/api/setting/available/mcp-servers',
  available_mcp_bundles: '/api/setting/available/mcp-bundles',
};

const CATALOG_ENDPOINT_IDS = Object.keys(CATALOG_ENDPOINTS);

const fetchCatalogEndpoint = async (endpointId: string): Promise<string> => {
  const token = process.env.CUSTOMER_TOKEN;
  if (!token) return JSON.stringify({ error: 'CUSTOMER_TOKEN not configured' });

  const path = CATALOG_ENDPOINTS[endpointId];
  if (!path) return JSON.stringify({ error: `Unknown endpoint: ${endpointId}. Available: ${CATALOG_ENDPOINT_IDS.join(', ')}` });

  const macMgmtUrl = process.env.MAC_MGMT_URL ?? '';
  if (!macMgmtUrl) return JSON.stringify({ error: 'MAC_MGMT_URL not configured' });
  const url = `${macMgmtUrl}${path}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) return JSON.stringify({ error: `HTTP ${res.status}`, detail: await res.text() });
    const data = await res.json();
    return JSON.stringify(stripInstalled(data));
  } catch (err) {
    return JSON.stringify({ error: 'Network error', detail: err instanceof Error ? err.message : String(err) });
  }
};

// ─── Tool definition ─────────────────────────────────────────────────────────

const GET_CATALOG_TOOL: Anthropic.Tool = {
  name: 'get_catalog',
  description:
    'Retrieve the available skills, bundles, MCP servers, and MCP bundles from the plan.ai platform catalog. Use this when a prospect asks what capabilities, integrations, or tools are available.',
  input_schema: {
    type: 'object',
    properties: {
      endpoint: {
        type: 'string',
        enum: CATALOG_ENDPOINT_IDS,
        description: 'Which catalog endpoint to query. Use "catalog" for the full overview.',
      },
    },
    required: ['endpoint'],
  },
};

// ─── Mode config ─────────────────────────────────────────────────────────────

export const salesMode: ChatModeConfig = {
  id: 'sales',
  stateTable: 'chat_state',
  messagesTable: 'chat_messages',
  modeColumn: 'sales',
  maxChars: 2048,
  model: 'claude-sonnet-4-20250514',
  maxTokens: 2048,

  buildSystemPrompt(locale: string): string {
    const prefix = locale.split('-')[0].toLowerCase();
    const lang = ISO6391.getName(prefix) || 'English';

    return `You are a helpful sales assistant for plan.ai — sovereign AI infrastructure built on dedicated Apple Silicon hardware for organizations.

IMPORTANT: Always respond in ${lang}.

Your role is to:
1. Understand the prospect's needs, industry, and organization size
2. Explain how plan.ai's sovereign AI infrastructure can help them
3. Answer questions about features, architecture, use cases, and deployment
4. Collect contact information when the prospect is interested

CRITICAL RULES:
- ALWAYS use the \`get_product_info\` tool to retrieve product documentation BEFORE answering product-related questions. Do not make up information.
- ALWAYS use the \`ask_question\` tool when asking the user a question. Never put questions in plain text.
- Use \`get_catalog\` when the prospect asks about available skills, tools, MCP servers, or integrations. Use endpoint "catalog" for a full overview.
- Available topics for \`get_product_info\`: ${DOC_IDS.join(', ')}

Guidelines:
- Be friendly, professional, and concise
- Focus on understanding their pain points first
- Highlight relevant features based on their needs (use get_product_info to find the right information)
- For detailed pricing or custom enterprise plans, collect their email to follow up
- Ask ONE question at a time using the \`ask_question\` tool`;
  },

  buildToolDefinitions(): Anthropic.Tool[] {
    return [ASK_QUESTION_TOOL, PROMPT_PREFERENCE_TOOL, GET_PRODUCT_INFO_TOOL, GET_CATALOG_TOOL];
  },

  async prepare(_userId: string, _config: ChatConfig, supabase: SupabaseClient | null): Promise<ModeContext | null> {
    const userProfile = supabase ? await fetchUserProfile(supabase, _userId) : undefined;
    return { userProfile };
  },

  injectContext(messages: Anthropic.MessageParam[], context: ModeContext): void {
    injectUserProfile(messages, context.userProfile as any);
  },

  executeTool: async (name: string, input: Record<string, unknown>, _context: ModeContext): Promise<string> => {
    if (name === 'get_product_info') {
      const topic = input.topic as string;
      const doc = lookupProductDoc(topic);
      if (!doc) {
        return JSON.stringify({ error: `Unknown topic: ${topic}. Available: ${DOC_IDS.join(', ')}` });
      }
      return doc;
    }
    if (name === 'get_catalog') {
      return fetchCatalogEndpoint(input.endpoint as string);
    }
    return JSON.stringify({ error: `Unknown tool: ${name}` });
  },
};

registerChatMode(salesMode);
