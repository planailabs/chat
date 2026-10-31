/**
 * Chat SSE — the EventSource on /api/v1/chat/events (cookie session), one for
 * all the user's conversations: connect, reconnect with backoff, disconnect.
 */

import { store } from '../../app/store';
import { api, CHAT_EVENT_NAMES } from '../../api';
import { routeServerEvent } from './events';
import { resyncAll } from './session';

let eventSource: EventSource | null = null;

/** Whether the close was intentional (sign-out) — suppress reconnect */
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
 * Opens the event stream. Resolves once it is open, so a message sent
 * afterwards can't miss its reply.
 */
export const connectEvents = (): Promise<void> => {
  if (eventSource && eventSource.readyState === EventSource.OPEN) return Promise.resolve();
  if (connectPromise) return connectPromise;
  if (!store.state.isAuthenticated) return Promise.resolve();

  intentionalClose = false;
  eventSource?.close();
  const es = new EventSource(api.chat.eventsUrl);
  eventSource = es;
  const isReconnect = reconnectAttempt > 0;

  // Listeners before open: nothing between open and registration is lost.
  for (const name of CHAT_EVENT_NAMES) {
    es.addEventListener(name, (event) => {
      // The connection's own 'error' events carry no data.
      if (!(event instanceof MessageEvent) || typeof event.data !== 'string') return;
      try {
        routeServerEvent(name, JSON.parse(event.data));
      } catch (err) {
        console.error('[sse-client] Failed to handle event:', name, err);
      }
    });
  }

  const opened = new Promise<void>((resolve) => {
    es.onopen = () => {
      reconnectAttempt = 0;
      // Events may have been missed while disconnected.
      if (isReconnect) void resyncAll();
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
      scheduleReconnect();
    };
  });
  connectPromise = opened;
  void opened.finally(() => {
    if (connectPromise === opened) connectPromise = null;
  });
  return opened;
};

/** Closes the event stream and suppresses reconnects (sign-out). */
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
};
