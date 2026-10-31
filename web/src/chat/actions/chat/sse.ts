/**
 * Chat SSE — the EventSource on /api/v1/chat/events for the active mode
 * (cookie session): connect, reconnect with backoff, disconnect.
 */

import { store } from '../../app/store';
import { api, CHAT_EVENT_NAMES, type ChatModeId } from '../../api';
import { handleServerEvent } from './events';
import { resyncHistory } from './session';

let eventSource: EventSource | null = null;
let eventSourceMode: ChatModeId | null = null;

/** Whether the close was intentional (sign-out, mode switch) — suppress reconnect */
let intentionalClose = false;

let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/** Resolves when the current EventSource is open (or failed to open) */
let connectPromise: Promise<void> | null = null;

const scheduleReconnect = () => {
  if (intentionalClose || reconnectTimer) return;
  const delay = Math.min(1000 * 2 ** reconnectAttempt, 30_000);
  reconnectAttempt++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectEvents();
  }, delay);
};

/**
 * Opens the event stream for the active mode. Resolves once it is open, so
 * a message sent afterwards can't miss its reply.
 */
export const connectEvents = (): Promise<void> => {
  const mode = store.state.activeChatMode;
  if (eventSource && eventSourceMode === mode && eventSource.readyState === EventSource.OPEN) return Promise.resolve();
  if (connectPromise) return connectPromise;
  if (!store.state.isAuthenticated) return Promise.resolve();

  intentionalClose = false;
  eventSource?.close();
  const es = new EventSource(api.chat.eventsUrl(mode));
  eventSource = es;
  eventSourceMode = mode;
  const isReconnect = reconnectAttempt > 0;

  // Listeners before open: nothing between open and registration is lost.
  for (const name of CHAT_EVENT_NAMES) {
    es.addEventListener(name, (event) => {
      // The connection's own 'error' events carry no data.
      if (!(event instanceof MessageEvent) || typeof event.data !== 'string') return;
      try {
        handleServerEvent(name, JSON.parse(event.data));
      } catch (err) {
        console.error('[sse-client] Failed to handle event:', name, err);
      }
    });
  }

  const opened = new Promise<void>((resolve) => {
    es.onopen = () => {
      reconnectAttempt = 0;
      // Events may have been missed while disconnected.
      if (isReconnect) void resyncHistory();
      resolve();
    };
    es.onerror = (event) => {
      // The server's own `error` events (a failed reply) arrive here too.
      if (event instanceof MessageEvent) return;
      resolve();
      if (eventSource !== es) return;
      console.warn('[sse-client] EventSource error/disconnected');
      es.close();
      eventSource = null;
      eventSourceMode = null;
      scheduleReconnect();
    };
  });
  connectPromise = opened;
  void opened.finally(() => {
    if (connectPromise === opened) connectPromise = null;
  });
  return opened;
};

/** Closes the event stream and suppresses reconnects (sign-out, mode switch). */
export const disconnectEvents = () => {
  intentionalClose = true;
  reconnectAttempt = 0;
  connectPromise = null;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  eventSource?.close();
  eventSource = null;
  eventSourceMode = null;
};
