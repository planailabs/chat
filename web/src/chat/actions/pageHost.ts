/**
 * The chat as an MCP Apps host (SEP-1865) for a page in a sandboxed iframe:
 * JSON-RPC 2.0 over postMessage. The page (an artifact on the generative-ui
 * suite, or a service tool's view) gets the chat's theme as MCP Apps style
 * variables; what it asks for goes to the server (`/api/v1/pages/{id}/…`),
 * which judges tool calls like the assistant's. A call only the user can
 * allow comes back as `confirm`: the host asks them, then calls again.
 *
 * The iframe has no origin (sandbox without allow-same-origin): messages are
 * told apart by their source window, and posted with targetOrigin "*" to
 * that window only.
 */

import { api, type PageDoc } from '../api';

export const PROTOCOL_VERSION = '2026-01-26';

type Json = Record<string, unknown>;
interface RpcMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: Json;
  result?: unknown;
  error?: { code: number; message: string };
}

/** The chat's design tokens (CSS variables on :root) as MCP Apps style variables. */
const TOKENS: Record<string, string[]> = {
  '--surface-base': ['--color-background-primary'],
  '--surface-elevated': ['--color-background-secondary'],
  '--surface-hover': ['--color-background-tertiary'],
  '--text-primary': ['--color-text-primary'],
  '--text-muted': ['--color-text-secondary'],
  '--border-muted': ['--color-border-primary'],
  '--accent': ['--color-accent', '--color-ring-primary', '--color-text-info', '--color-border-info'],
  '--accent-danger': ['--color-text-danger', '--color-border-danger'],
  '--accent-strong': ['--color-text-success', '--color-border-success'],
};

/** The host's style variables, read from the chat's current theme. */
export const styleVariables = (read: (name: string) => string, fontFamily: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [token, names] of Object.entries(TOKENS)) {
    const value = read(token).trim();
    if (value) for (const n of names) out[n] = value;
  }
  if (fontFamily.trim()) out['--font-sans'] = fontFamily.trim();
  return out;
};

const currentStyles = () => {
  const cs = getComputedStyle(document.documentElement);
  return { variables: styleVariables((n) => cs.getPropertyValue(n), cs.fontFamily) };
};

/** Only http(s) links leave the chat. */
export const linkAllowed = (url: unknown): url is string => {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};

export interface PageHostOptions {
  theme: () => 'light' | 'dark';
  lang: () => string;
  /** The user decides a call the checks left to them. */
  confirm: (message: string) => Promise<boolean>;
  /** The page asks for inline or full screen; answers the mode it got. */
  displayMode: (mode: string) => 'inline' | 'fullscreen';
  currentDisplayMode: () => 'inline' | 'fullscreen';
  onError?: (message: string) => void;
}

const METHOD_NOT_FOUND = -32601;
const FAILED = -32000;

export class PageHost {
  private initialized = false;

  constructor(
    private readonly frame: () => Window | null,
    private readonly doc: PageDoc,
    private readonly opts: PageHostOptions,
  ) {}

  /** Handles a message from the page (others are ignored). */
  handle = (event: MessageEvent) => {
    const win = this.frame();
    if (!win || event.source !== win) return;
    const m = event.data as RpcMessage;
    if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return;
    if (m.id === undefined) {
      this.notification(m.method, m.params ?? {});
      return;
    }
    const id = m.id;
    this.request(m.method, m.params ?? {}).then(
      (result) => this.post({ jsonrpc: '2.0', id, result }),
      (e: unknown) => {
        const err = e as { code?: number; message?: string };
        this.post({ jsonrpc: '2.0', id, error: { code: typeof err.code === 'number' ? err.code : FAILED, message: err.message ?? String(e) } });
      },
    );
  };

  private post(m: RpcMessage) {
    this.frame()?.postMessage(m, '*');
  }

  private notify(method: string, params: Json) {
    // Nothing goes to the page before it said it's initialized.
    if (this.initialized) this.post({ jsonrpc: '2.0', method, params });
  }

  hostContext(): Json {
    const ctx: Json = {
      theme: this.opts.theme(),
      styles: currentStyles(),
      displayMode: this.opts.currentDisplayMode(),
      availableDisplayModes: ['inline', 'fullscreen'],
      locale: this.opts.lang(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      platform: 'web',
      userAgent: 'plan.ai chat',
    };
    if (this.doc.tool) ctx.toolInfo = { tool: this.doc.tool.definition ?? { name: this.doc.tool.name } };
    return ctx;
  }

  /** The chat's theme changed. */
  themeChanged() {
    this.notify('ui/notifications/host-context-changed', { theme: this.opts.theme(), styles: currentStyles() });
  }

  displayModeChanged() {
    this.notify('ui/notifications/host-context-changed', { displayMode: this.opts.currentDisplayMode() });
  }

  /** The page's KV view changed on the server. */
  kvChanged(kv: Json) {
    this.notify('gui/notifications/kv-changed', { kv });
  }

  /** Before the page goes away (MCP Apps teardown; not waited for). */
  teardown(reason: string) {
    if (this.initialized) this.post({ jsonrpc: '2.0', id: `teardown-${Date.now()}`, method: 'ui/resource-teardown', params: { reason } });
  }

  private notification(method: string, params: Json) {
    switch (method) {
      case 'ui/notifications/initialized':
        this.initialized = true;
        // A view gets its call's input, then its result (the call is done).
        if (this.doc.kind === 'mcp_app' && this.doc.tool) {
          this.notify('ui/notifications/tool-input', { arguments: this.doc.tool.arguments ?? {} });
          if (this.doc.tool.result) this.notify('ui/notifications/tool-result', this.doc.tool.result as Json);
        }
        break;
      case 'notifications/message':
        console.info(`[page ${this.doc.title}]`, params.level ?? 'info', params.data ?? params);
        break;
      // size-changed: the panel gives the page its full height; nothing to do.
    }
  }

  private async request(method: string, p: Json): Promise<unknown> {
    const id = this.doc.id;
    switch (method) {
      case 'ui/initialize':
        return {
          protocolVersion: PROTOCOL_VERSION,
          hostInfo: { name: 'plan.ai chat', version: '1' },
          hostCapabilities: { openLinks: {}, serverTools: {}, logging: {} },
          hostContext: this.hostContext(),
        };
      case 'ping':
        return {};
      case 'tools/call': {
        if (typeof p.name !== 'string') throw { code: -32602, message: 'tools/call needs a name' };
        const args = (p.arguments && typeof p.arguments === 'object' ? p.arguments : {}) as Json;
        const first = await api.pages.call(id, { name: p.name, arguments: args });
        if (!('confirm' in first)) return first;
        const confirm = first.confirm as { message: string };
        if (!(await this.opts.confirm(confirm.message))) {
          return { content: [{ type: 'text', text: 'The user declined this call; it was not made.' }], isError: true };
        }
        return api.pages.call(id, { name: p.name, arguments: args, confirmed: true });
      }
      case 'ui/message': {
        const content = p.content as { type?: string; text?: unknown } | undefined;
        const text = typeof content?.text === 'string' ? content.text.trim() : '';
        if (!text) throw { code: -32602, message: 'ui/message needs text content' };
        await api.pages.message(id, text, this.opts.lang());
        return {};
      }
      case 'ui/update-model-context':
        await api.pages.context(id, { content: p.content ?? null, structuredContent: p.structuredContent ?? null });
        return {};
      case 'ui/open-link':
        if (!linkAllowed(p.url)) throw { code: FAILED, message: 'Invalid URL' };
        window.open(p.url, '_blank', 'noopener,noreferrer');
        return {};
      case 'ui/request-display-mode':
        return { mode: this.opts.displayMode(String(p.mode)) };
      case 'gui/kv':
        if (this.doc.kind !== 'artifact') return { kv: {} };
        return api.pages.kv(id);
      case 'gui/backflow': {
        if (this.doc.kind !== 'artifact') throw { code: METHOD_NOT_FOUND, message: 'only artifacts take backflow' };
        if (typeof p.action !== 'string' || !p.action) throw { code: -32602, message: 'gui/backflow needs an action' };
        return api.pages.backflow(id, {
          action: p.action,
          component: typeof p.component === 'string' ? p.component : null,
          value: p.value ?? null,
          version: typeof p.version === 'string' ? p.version : String(this.doc.version),
          lang: this.opts.lang(),
        });
      }
      default:
        throw { code: METHOD_NOT_FOUND, message: `${method} isn't supported here` };
    }
  }
}
