/**
 * Haiku-based response evaluator for integration tests.
 *
 * Sends the WebSocket message transcript + an expectation to Claude Haiku,
 * which returns a pass/fail judgment with reasoning.
 */

import Anthropic from '@anthropic-ai/sdk';

export interface EvalResult {
  pass: boolean;
  reasoning: string;
}

export interface LogEntry {
  direction: 'client' | 'server';
  data: unknown;
  ts: number;
}

export async function evaluateExchange(
  apiKey: string,
  messages: LogEntry[],
  expectation: string,
): Promise<EvalResult> {
  const anthropic = new Anthropic({ apiKey });

  const transcript = messages
    .map((m) => `[${m.direction}] ${JSON.stringify(m.data)}`)
    .join('\n');

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system:
      'You are a test evaluator. Given a WebSocket message exchange and an expectation, determine if the exchange satisfies the expectation. Respond with JSON only: { "pass": boolean, "reasoning": string }',
    messages: [
      {
        role: 'user',
        content: `## Transcript\n\n${transcript}\n\n## Expectation\n\n${expectation}`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  try {
    // Extract JSON from possible markdown code fences
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { pass: false, reasoning: `Failed to parse evaluator response: ${text}` };
    const parsed = JSON.parse(jsonMatch[0]);
    return { pass: Boolean(parsed.pass), reasoning: String(parsed.reasoning) };
  } catch {
    return { pass: false, reasoning: `Failed to parse evaluator response: ${text}` };
  }
}

/**
 * Generate a contextual answer to a question using Haiku,
 * given the conversation transcript and a persona description.
 */
export async function generateAnswer(
  apiKey: string,
  messages: LogEntry[],
  question: unknown,
  persona: string,
): Promise<string> {
  const anthropic = new Anthropic({ apiKey });

  const transcript = messages
    .map((m) => `[${m.direction}] ${JSON.stringify(m.data)}`)
    .join('\n');

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: `You are simulating a user in a chat conversation. ${persona} Answer the question naturally and concisely — just the answer text, nothing else.`,
    messages: [
      {
        role: 'user',
        content: `## Conversation so far\n\n${transcript}\n\n## Question to answer\n\n${JSON.stringify(question)}\n\nRespond with just your answer text.`,
      },
    ],
  });

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}
