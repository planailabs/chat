/**
 * Integration test: exercises the real chat handler via POST + SSE
 * against live Anthropic + mac-mgmt APIs, without Supabase auth or DB persistence.
 *
 * Requires CUSTOMER_TOKEN, ANTHROPIC_API_KEY, MAC_MGMT_URL in .env.local.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { startServer, readDotenv } from './test-server';
import { evaluateExchange, generateAnswer, type LogEntry } from './haiku-evaluator';
import type { ChatModeId } from '../src/lib/chat/modes';

// ─── Env ──────────────────────────────────────────────────────────────────────

const dotenv = readDotenv();

function getApiKey(): string {
  const key = dotenv.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  return key;
}

// ─── SSE TestClient ───────────────────────────────────────────────────────────

class TestClient {
  private log: LogEntry[] = [];
  private listeners: Array<(type: string, data: Record<string, unknown>) => void> = [];
  private sseReq: http.ClientRequest | null = null;

  constructor(
    private port: number,
    private lang = 'en',
    private mode: ChatModeId = 'machine_config',
  ) {}

  /** Open an SSE connection to GET /api/chat/events */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = http.get(
        `http://localhost:${this.port}/api/chat/events?mode=${this.mode}`,
        { headers: { Accept: 'text/event-stream' } },
        (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`SSE connect failed: ${res.statusCode}`));
            return;
          }

          let buffer = '';
          let currentEvent = '';

          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                const raw = line.slice(6);
                try {
                  const data = JSON.parse(raw) as Record<string, unknown>;
                  this.log.push({ direction: 'server', data, ts: Date.now() });
                  for (const fn of this.listeners) fn(currentEvent, data);
                } catch { /* ignore parse errors */ }
                currentEvent = '';
              }
              // Ignore comments (': ping') and blank lines
            }
          });

          res.on('error', (err) => {
            console.error('[test-client] SSE error:', err);
          });

          // Consider connected once we get the response headers
          resolve();
        },
      );

      req.on('error', reject);
      this.sseReq = req;
    });
  }

  /** POST a message/answer and wait for events until done or question. */
  async send(data: { type: string; text: string }, timeout = 60_000): Promise<LogEntry[]> {
    this.log.push({ direction: 'client', data, ts: Date.now() });

    const body = JSON.stringify(data);
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.request(
        `http://localhost:${this.port}/api/chat/message?lang=${this.lang}&mode=${this.mode}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        },
        resolve,
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    // Drain response body
    await new Promise<void>((r) => { res.resume(); res.on('end', r); });

    if (res.statusCode === 409) {
      // Already processing — SSE will deliver events
      return this.waitForTerminal(timeout);
    }

    if (res.statusCode !== 202) {
      throw new Error(`POST failed: ${res.statusCode}`);
    }

    return this.waitForTerminal(timeout);
  }

  /** Wait until a terminal event (done or question) arrives via SSE. */
  private waitForTerminal(timeout: number): Promise<LogEntry[]> {
    return new Promise((resolve, reject) => {
      const collected: LogEntry[] = [];
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for terminal event after ${timeout}ms`));
      }, timeout);

      const handler = (type: string, data: Record<string, unknown>) => {
        collected.push({ direction: 'server', data, ts: Date.now() });
        if (type === 'done' || type === 'question' || type === 'error') {
          cleanup();
          resolve(collected);
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.listeners = this.listeners.filter((fn) => fn !== handler);
      };

      this.listeners.push(handler);
    });
  }

  /**
   * Send and auto-answer questions (via Haiku) until done.
   */
  async sendUntilDone(
    data: { type: string; text: string },
    opts: { apiKey: string; persona?: string; timeout?: number },
  ): Promise<LogEntry[]> {
    const persona = opts.persona ?? 'You are Maciej, a software developer setting up a new plan.ai machine named Jarvis.';
    let events = await this.send(data, opts.timeout ?? 60_000);

    while (lastEventType(events) === 'question') {
      const questionData = lastEventData(events);
      const question = (questionData as any)?.question;
      console.log(`[test] Generating answer for: ${JSON.stringify(question?.question ?? questionData).slice(0, 100)}`);
      const answer = await generateAnswer(
        opts.apiKey,
        this.getLog(),
        question,
        persona,
      );
      console.log(`[test] Haiku answer: ${answer.slice(0, 100)}`);
      events = await this.send({ type: 'answer', text: answer }, opts.timeout ?? 60_000);
    }

    return events;
  }

  getLog(): LogEntry[] {
    return [...this.log];
  }

  close(): void {
    if (this.sseReq) {
      this.sseReq.destroy();
      this.sseReq = null;
    }
  }
}

function lastEventType(events: LogEntry[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].direction === 'server') {
      return (events[i].data as any)?.type;
    }
  }
  return undefined;
}

function lastEventData(events: LogEntry[]): unknown {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].direction === 'server') {
      return events[i].data;
    }
  }
  return undefined;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** POST helper that returns the status code */
function postRaw(port: number, path: string, jsonBody: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `http://localhost:${port}${path}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(jsonBody) },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode!));
      },
    );
    req.on('error', reject);
    req.write(jsonBody);
    req.end();
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Chat Integration', () => {
  let port: number;
  let closeServer: () => void;
  let apiKey: string;

  beforeAll(async () => {
    const server = await startServer();
    port = server.port;
    closeServer = server.close;
    apiKey = getApiKey();
  });

  beforeEach(async () => {
    // Reset conversation state between tests
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        `http://localhost:${port}/api/chat/reset`,
        { method: 'POST' },
        (res) => { res.resume(); res.on('end', () => resolve()); },
      );
      req.on('error', reject);
      req.end();
    });
  });

  afterAll(() => {
    closeServer?.();
  });

  // ─── Machine Config Mode ────────────────────────────────────────────────

  test('machine_config: full conversation — agent name → user name → skills', async () => {
    const client = new TestClient(port, 'en', 'machine_config');
    await client.connect();

    // Phase 1: initial message → expect ask_question about agent name
    const events1 = await client.send({ type: 'message', text: 'Hi, I want to set up my machine' }, 60_000);
    expect(lastEventType(events1)).toBe('question');
    const eval1 = await evaluateExchange(apiKey, client.getLog(),
      'The server asked what the user wants to call their agent/assistant');
    console.log(`[eval1] pass=${eval1.pass} — ${eval1.reasoning}`);
    expect(eval1.pass).toBe(true);

    // Phase 2: answer agent name → expect ask_question about user name
    const events2 = await client.send({ type: 'answer', text: 'Jarvis' }, 60_000);
    expect(lastEventType(events2)).toBe('question');
    const eval2 = await evaluateExchange(apiKey, client.getLog(),
      'The server asked what the user wants to be called (their name)');
    console.log(`[eval2] pass=${eval2.pass} — ${eval2.reasoning}`);
    expect(eval2.pass).toBe(true);

    // Phase 3: answer user name → expect config update + industry question
    const events3 = await client.send({ type: 'answer', text: 'Maciej' }, 60_000);
    expect(lastEventType(events3)).toBe('question');
    const eval3 = await evaluateExchange(apiKey, client.getLog(),
      'The server updated config and asked about industry or work type');
    console.log(`[eval3] pass=${eval3.pass} — ${eval3.reasoning}`);
    expect(eval3.pass).toBe(true);

    // Phase 4: answer industry → expect skill/tool fetching until done
    const events4 = await client.sendUntilDone(
      { type: 'answer', text: 'Software development' },
      { apiKey, timeout: 180_000 },
    );
    const eval4 = await evaluateExchange(apiKey, client.getLog(),
      'After the user said "Software development", the server called tools to fetch available skills, bundles, or MCP servers');
    console.log(`[eval4] pass=${eval4.pass} — ${eval4.reasoning}`);
    expect(eval4.pass).toBe(true);

    // Log full transcript
    console.log('\n=== Full Transcript ===');
    for (const entry of client.getLog()) {
      console.log(`[${entry.direction}] ${JSON.stringify(entry.data)}`);
    }

    client.close();
  }, 300_000);

  test('machine_config: responds in German when lang=de', async () => {
    const client = new TestClient(port, 'de', 'machine_config');
    await client.connect();

    const events1 = await client.send(
      { type: 'message', text: 'Hallo, ich möchte meinen Rechner einrichten' },
      60_000,
    );
    expect(lastEventType(events1)).toBe('question');

    const eval1 = await evaluateExchange(apiKey, client.getLog(),
      'The server responded in German (not English) and asked a question in German');
    console.log(`[eval-de] pass=${eval1.pass} — ${eval1.reasoning}`);
    expect(eval1.pass).toBe(true);

    console.log('\n=== German Transcript ===');
    for (const entry of client.getLog()) {
      console.log(`[${entry.direction}] ${JSON.stringify(entry.data)}`);
    }

    client.close();
  }, 120_000);

  // ─── Sales Mode ─────────────────────────────────────────────────────────

  test('sales: responds to inquiry and asks a structured question', async () => {
    const client = new TestClient(port, 'en', 'sales');
    await client.connect();

    const events1 = await client.send(
      { type: 'message', text: 'We have 50 Macs and need help managing them' },
      60_000,
    );

    // Sales mode should respond and use ask_question tool
    const terminal = lastEventType(events1);
    expect(terminal === 'question' || terminal === 'done').toBe(true);

    const eval1 = await evaluateExchange(apiKey, client.getLog(),
      'The server responded as a sales assistant, acknowledging the fleet size and either asking a follow-up question or providing helpful information');
    console.log(`[eval-sales] pass=${eval1.pass} — ${eval1.reasoning}`);
    expect(eval1.pass).toBe(true);

    console.log('\n=== Sales Transcript ===');
    for (const entry of client.getLog()) {
      console.log(`[${entry.direction}] ${JSON.stringify(entry.data)}`);
    }

    client.close();
  }, 120_000);

  // ─── Locking (per-mode isolation) ───────────────────────────────────────

  test('locking: second POST to same mode returns 409 while first is processing', async () => {
    const client1 = new TestClient(port, 'en', 'machine_config');
    const client2 = new TestClient(port, 'en', 'machine_config');
    await client1.connect();
    await client2.connect();

    // Client1 sends a message (starts processing)
    const status1 = await postRaw(port,
      '/api/chat/message?lang=en&mode=machine_config',
      JSON.stringify({ type: 'message', text: 'Hello' }),
    );
    expect(status1).toBe(202);

    // Client2 sends immediately to same mode — should get 409
    const status2 = await postRaw(port,
      '/api/chat/message?lang=en&mode=machine_config',
      JSON.stringify({ type: 'message', text: 'Also hello' }),
    );
    expect(status2).toBe(409);

    // Wait for client1's processing to complete
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { clearInterval(poll); resolve(); }, 60_000);

      const poll = setInterval(() => {
        const log = client1.getLog();
        const hasDone = log.some((e) => e.direction === 'server' && (e.data as any)?.type === 'done');
        const hasQuestion = log.some((e) => e.direction === 'server' && (e.data as any)?.type === 'question');
        if (hasDone || hasQuestion) {
          clearInterval(poll);
          clearTimeout(timer);
          resolve();
        }
      }, 100);
    });

    // Both clients should have received events (shared SSE for same user+mode)
    const client1Events = client1.getLog().filter((e) => e.direction === 'server');
    const client2Events = client2.getLog().filter((e) => e.direction === 'server');
    expect(client1Events.length).toBeGreaterThan(0);
    expect(client2Events.length).toBeGreaterThan(0);

    client1.close();
    client2.close();
  }, 120_000);

  test('locking: different modes can process concurrently', async () => {
    const mcClient = new TestClient(port, 'en', 'machine_config');
    const salesClient = new TestClient(port, 'en', 'sales');
    await mcClient.connect();
    await salesClient.connect();

    // POST to machine_config
    const status1 = await postRaw(port,
      '/api/chat/message?lang=en&mode=machine_config',
      JSON.stringify({ type: 'message', text: 'Hello' }),
    );
    expect(status1).toBe(202);

    // POST to sales concurrently — should NOT be blocked (different mode)
    const status2 = await postRaw(port,
      '/api/chat/message?lang=en&mode=sales',
      JSON.stringify({ type: 'message', text: 'Tell me about plan.ai' }),
    );
    expect(status2).toBe(202);

    // Wait for both to finish
    const waitForTerminal = (client: TestClient) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => { clearInterval(poll); resolve(); }, 60_000);
        const poll = setInterval(() => {
          const log = client.getLog();
          const terminal = log.some((e) =>
            e.direction === 'server' &&
            ['done', 'question', 'error'].includes((e.data as any)?.type),
          );
          if (terminal) {
            clearInterval(poll);
            clearTimeout(timer);
            resolve();
          }
        }, 100);
      });

    await Promise.all([waitForTerminal(mcClient), waitForTerminal(salesClient)]);

    // Both should have received events
    expect(mcClient.getLog().filter((e) => e.direction === 'server').length).toBeGreaterThan(0);
    expect(salesClient.getLog().filter((e) => e.direction === 'server').length).toBeGreaterThan(0);

    mcClient.close();
    salesClient.close();
  }, 120_000);
});
