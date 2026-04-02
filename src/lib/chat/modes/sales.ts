/**
 * Sales Chat Mode
 *
 * Simple conversational mode for sales inquiries.
 * Uses only the ask_question tool for structured user interaction.
 */

import ISO6391 from 'iso-639-1';
import { registerChatMode, type ChatModeConfig } from '../modes';
import { ASK_QUESTION_TOOL, PROMPT_PREFERENCE_TOOL } from '../tools';
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

    return `You are a helpful sales assistant for plan.ai, a platform that helps companies manage and configure Mac fleets with AI.

IMPORTANT: Always respond in ${lang}.

Your role is to:
1. Understand the prospect's needs and company size
2. Explain how plan.ai can help them manage their Mac fleet
3. Answer questions about features, pricing, and deployment
4. Collect contact information when the prospect is interested

CRITICAL: ALWAYS use the \`ask_question\` tool when asking the user a question. Never put questions in plain text.

Guidelines:
- Be friendly, professional, and concise
- Focus on understanding their pain points first
- Highlight relevant features based on their needs
- For detailed pricing or custom enterprise plans, collect their email to follow up
- Ask ONE question at a time using the \`ask_question\` tool`;
  },

  buildToolDefinitions(): Anthropic.Tool[] {
    return [ASK_QUESTION_TOOL, PROMPT_PREFERENCE_TOOL];
  },

  executeTool: null,
};

registerChatMode(salesMode);
