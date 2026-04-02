/**
 * Sales Chat Mode
 *
 * Conversational mode for sales inquiries.
 * Uses ask_question, prompt_preference, and get_product_info tools.
 */

import ISO6391 from 'iso-639-1';
import { registerChatMode, type ChatModeConfig, type ModeContext } from '../modes';
import { ASK_QUESTION_TOOL, PROMPT_PREFERENCE_TOOL, GET_PRODUCT_INFO_TOOL } from '../tools';
import { lookupProductDoc } from '../content';
import type Anthropic from '@anthropic-ai/sdk';

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
- Available topics for \`get_product_info\`: overview, departments, architecture, use-cases, getting-started, faq

Guidelines:
- Be friendly, professional, and concise
- Focus on understanding their pain points first
- Highlight relevant features based on their needs (use get_product_info to find the right information)
- For detailed pricing or custom enterprise plans, collect their email to follow up
- Ask ONE question at a time using the \`ask_question\` tool`;
  },

  buildToolDefinitions(): Anthropic.Tool[] {
    return [ASK_QUESTION_TOOL, PROMPT_PREFERENCE_TOOL, GET_PRODUCT_INFO_TOOL];
  },

  executeTool: async (name: string, input: Record<string, unknown>, _context: ModeContext): Promise<string> => {
    if (name === 'get_product_info') {
      const topic = input.topic as string;
      const doc = lookupProductDoc(topic);
      if (!doc) {
        return JSON.stringify({ error: `Unknown topic: ${topic}. Available: overview, departments, architecture, use-cases, getting-started, faq` });
      }
      return doc;
    }
    return JSON.stringify({ error: `Unknown tool: ${name}` });
  },
};

registerChatMode(salesMode);
