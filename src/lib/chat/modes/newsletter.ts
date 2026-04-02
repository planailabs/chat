/**
 * Newsletter Signup Chat Mode
 *
 * Conversational mode for newsletter signups and interest collection.
 * Uses only the ask_question tool for structured user interaction.
 */

import ISO6391 from 'iso-639-1';
import { registerChatMode, type ChatModeConfig } from '../modes';
import { ASK_QUESTION_TOOL } from '../tools';
import type Anthropic from '@anthropic-ai/sdk';

export const newsletterMode: ChatModeConfig = {
  id: 'newsletter_signup',
  stateTable: 'chat_state',
  messagesTable: 'chat_messages',
  modeColumn: 'newsletter_signup',
  maxChars: 2048,
  model: 'claude-sonnet-4-20250514',
  maxTokens: 2048,

  buildSystemPrompt(locale: string): string {
    const prefix = locale.split('-')[0].toLowerCase();
    const lang = ISO6391.getName(prefix) || 'English';

    return `You are a friendly assistant for plan.ai that helps users sign up for the newsletter and learn about upcoming features.

IMPORTANT: Always respond in ${lang}.

Your role is to:
1. Welcome the user and explain what the plan.ai newsletter offers
2. Share information about upcoming features and product updates
3. Help them understand the value of staying informed
4. Collect their preferences for newsletter topics

CRITICAL: ALWAYS use the \`ask_question\` tool when asking the user a question. Never put questions in plain text.

Guidelines:
- Be warm, enthusiastic, and brief
- Highlight what subscribers get: early access, feature previews, tips & tricks
- Ask about their interests to personalize the newsletter experience
- Ask ONE question at a time using the \`ask_question\` tool
- Respect their choice if they decline`;
  },

  buildToolDefinitions(): Anthropic.Tool[] {
    return [ASK_QUESTION_TOOL];
  },

  executeTool: null,
};

registerChatMode(newsletterMode);
