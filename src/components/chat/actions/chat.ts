/**
 * Chat Actions
 *
 * Handles chat conversation flow:
 * - Prompt submission and response streaming
 * - Post-login sequences (signed-in bubble, newsletter prompt)
 * - Session restoration from pre-auth cache
 * - Newsletter choice handling
 * - Multi-mode AI chat (machine config, sales, newsletter)
 */

import { store } from '../app/store';
import { chatStorageKey, type ClientChatModeId } from '../constants';
import {
  locales,
  type LocaleContent,
  type StreamConfig,
  type ConversationStep,
  type StepCta,
} from '../content';
import {
  planPostLoginQuestion,
  getScenarioStep,
  getNextPointerFromCta,
  getScenarioEntryStep,
  type ConversationPointer,
  type CtaChoice,
  planPromptConversation,
} from '../chat/conversationPlanner';
import { ctaController } from '../chat/ctaController';
import { persistNewsletterChoice } from './settings';
import {
  streamingController,
  type StartPromptOptions,
} from '../chat/streaming';
import {
  createCachedPrompt,
  appendPromptToCache,
  readPreAuthState,
  updatePreAuthState,
} from '../auth/preAuthCache';
import {
  persistPromptsToSupabase,
  syncCachedPromptsToSupabase,
} from './messages';
import { startCharacterStream } from '../utils/stream';

// ─────────────────────────────────────────────────────────────────────────────
// Timer State
// ─────────────────────────────────────────────────────────────────────────────
let postLoginDelayTimeout: ReturnType<typeof setTimeout> | null = null;
let postLoginStreamCancel: (() => void) | null = null;

const clearPostLoginTimers = () => {
  if (postLoginDelayTimeout) {
    clearTimeout(postLoginDelayTimeout);
    postLoginDelayTimeout = null;
  }
  if (postLoginStreamCancel) {
    postLoginStreamCancel();
    postLoginStreamCancel = null;
  }
};

export const clearChatTimers = clearPostLoginTimers;

const startNewsletterQuestionStream = () => {
  const newsletterState = store.state.chat?.postLogin?.newsletter;
  if (!newsletterState) {
    return;
  }
  if (postLoginStreamCancel) {
    postLoginStreamCancel();
    postLoginStreamCancel = null;
  }

  const totalLength = newsletterState.fullText.length;

  postLoginStreamCancel = startCharacterStream(
    totalLength,
    newsletterState.stream.chunkSize,
    newsletterState.stream.intervalMs,
    (index) => {
      const currentNewsletter = store.state.chat?.postLogin?.newsletter;
      if (!currentNewsletter) return;
      currentNewsletter.visibleText = currentNewsletter.fullText.slice(
        0,
        index,
      );
      store.notify();
    },
    () => {
      postLoginStreamCancel = null;
      const currentNewsletter = store.state.chat?.postLogin?.newsletter;
      if (!currentNewsletter) return;

      currentNewsletter.isStreaming = false;
      store.notify();
      postLoginDelayTimeout = setTimeout(() => {
        const chat = store.state.chat;
        if (chat?.postLogin?.newsletter) {
          if (chat.postLogin.newsletter.enableCtas) {
            chat.postLogin.newsletter.ctaVisible = true;
          }
          store.notify();
        }
      }, 250);
    },
  );
};

const startNewsletterFollowupStream = () => {
  const followup = store.state.chat?.postLogin?.newsletter?.followup;
  if (!followup) {
    return;
  }
  if (postLoginStreamCancel) {
    postLoginStreamCancel();
    postLoginStreamCancel = null;
  }

  const totalLength = followup.fullText.length;

  postLoginStreamCancel = startCharacterStream(
    totalLength,
    followup.stream.chunkSize,
    followup.stream.intervalMs,
    (index) => {
      const currentFollowup = store.state.chat?.postLogin?.newsletter?.followup;
      if (!currentFollowup) return;
      currentFollowup.visibleText = currentFollowup.fullText.slice(0, index);
      store.notify();
    },
    () => {
      postLoginStreamCancel = null;
      const currentFollowup = store.state.chat?.postLogin?.newsletter?.followup;
      if (!currentFollowup) return;
      currentFollowup.isStreaming = false;
      store.notify();
    },
  );
};

export const startNewsletterPrompt = (params: {
  text: string;
  stream: StreamConfig;
  showSignedInBubble: boolean;
  enableCtas: boolean;
  pointer?: ConversationPointer | null;
}) => {
  const state = store.state;
  if (!state.chat) {
    return;
  }
  state.chat.postLogin = {
    signedInBubbleVisible: params.showSignedInBubble,
    signedInBubbleJustAppeared: params.showSignedInBubble,
    newsletter: {
      visibleText: '',
      fullText: params.text,
      stream: params.stream,
      isStreaming: true,
      ctaVisible: false,
      enableCtas: params.enableCtas,
      ctaLocked: false,
    },
  };
  if (params.pointer) {
    state.chat.conversation = params.pointer;
  }
  store.notify();
  clearPostLoginTimers();
  postLoginDelayTimeout = setTimeout(() => {
    startNewsletterQuestionStream();
  }, params.stream.initialDelayMs);
};

export const startPostLoginSequence = () => {
  const state = store.state;
  if (
    !state.chat ||
    !state.chat.restoredFromChatCta ||
    state.chat.postLogin ||
    !state.userEmail
  ) {
    return;
  }
  const locale = locales[state.localeKey];
  const templateStep =
    locale.conversationScenarios.postLoginNewsletter.steps[
      'newsletter-question'
    ];
  const plan = planPostLoginQuestion(state);
  const scenarioId = locale.conversationScenarios.postLoginNewsletter.id;
  const text =
    plan === 'alreadySubscribed'
      ? locale.chat.postLogin.alreadySubscribedQuestion
      : templateStep.text;
  state.chat.ctaVisible = true;
  state.chat.isCtaLocked = true;
  startNewsletterPrompt({
    text,
    stream: templateStep.stream,
    showSignedInBubble: true,
    enableCtas: plan !== 'alreadySubscribed',
    pointer: { scenarioId, stepId: 'newsletter-question' },
  });
};

let shouldRunPostLoginSequence = false;

export const setShouldRunPostLoginSequence = (val: boolean) => {
  shouldRunPostLoginSequence = val;
};

export const tryStartPostLoginSequence = () => {
  const state = store.state;
  if (!shouldRunPostLoginSequence) {
    return;
  }
  // NOTE: We allow 'unknown' status to proceed here.
  // If a race condition occurs between creating a new user (upsert) and fetching their profile (select),
  // the profile fetch might return null, resulting in an 'unknown' status.
  // In this case, we default to treating them as unsubscribed and ask the question.
  // We strictly block only if we know a sync is actively in progress to avoid jumping the gun.
  if (state.newsletterPreference.isSyncing) {
    return;
  }
  if (
    !state.chat ||
    !state.chat.restoredFromChatCta ||
    state.chat.postLogin || // Guard: if postLogin already exists, don't overwrite/restart
    !state.userEmail
  ) {
    shouldRunPostLoginSequence = false;
    return;
  }
  shouldRunPostLoginSequence = false;
  startPostLoginSequence();
};

export const startNewsletterReconsiderFlow = (locale: LocaleContent) => {
  if (!store.state.chat || !store.state.isAuthenticated) {
    return;
  }
  const newsletterScenario = locale.conversationScenarios.postLoginNewsletter;
  const reconsiderStep = newsletterScenario.steps['newsletter-reconsider'];
  const fallbackStep = newsletterScenario.steps['newsletter-question'];
  const step = reconsiderStep ?? fallbackStep;
  const pointerStepId = reconsiderStep
    ? 'newsletter-reconsider'
    : 'newsletter-question';
  startNewsletterPrompt({
    text: step.text,
    stream: step.stream,
    showSignedInBubble: false,
    enableCtas: true,
    pointer: {
      scenarioId: newsletterScenario.id,
      stepId: pointerStepId,
    },
  });
};

const resetChatNewsletterState = () => {
  const newsletterState = store.state.chat?.postLogin?.newsletter;
  if (!newsletterState) {
    return;
  }
  newsletterState.ctaLocked = false;
  newsletterState.response = undefined;
  newsletterState.responseBubble = undefined;
  newsletterState.followup = undefined;
  store.notify();
};

const queueNewsletterFollowup = (
  step: ConversationStep,
  pointer?: ConversationPointer | null,
) => {
  const chat = store.state.chat;
  if (!chat?.postLogin?.newsletter) {
    return;
  }
  chat.postLogin.newsletter.followup = {
    visibleText: '',
    fullText: step.text,
    stream: step.stream,
    isStreaming: true,
  };
  if (pointer) {
    chat.conversation = pointer;
  }
  store.notify();
  startNewsletterFollowupStream();
};

export const handleChatNewsletterChoice = (choice: 'yes' | 'no') => {
  const locale = locales[store.state.localeKey];
  ctaController.handleNewsletterChoice(choice, locale);
  persistNewsletterChoice(choice, 'chat_flow').then((didPersist) => {
    if (!didPersist) {
      resetChatNewsletterState();
      return;
    }
    const pointer = store.state.chat?.conversation ?? {
      scenarioId: locale.conversationScenarios.postLoginNewsletter.id,
      stepId: 'newsletter-question',
    };
    const currentStep = getScenarioStep(locale, pointer);
    const ctaChoice: CtaChoice = choice === 'yes' ? 'positive' : 'negative';
    const nextPointer =
      currentStep && getNextPointerFromCta(pointer, currentStep, ctaChoice);
    if (nextPointer) {
      const resolution = getScenarioEntryStep(
        locale,
        nextPointer.scenarioId,
        nextPointer.stepId,
      );
      if (resolution) {
        queueNewsletterFollowup(resolution.step, resolution.pointer);
        return;
      }
    }
    const fallbackKey =
      choice === 'yes' ? 'newsletter-confirm' : 'newsletter-decline';
    const fallbackStep =
      locale.conversationScenarios.postLoginNewsletter.steps[fallbackKey];
    queueNewsletterFollowup(fallbackStep, {
      scenarioId: locale.conversationScenarios.postLoginNewsletter.id,
      stepId: fallbackKey,
    });
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// AI Chat Persistence (server-side via Supabase, sessionStorage as cache)
// ─────────────────────────────────────────────────────────────────────────────

type StoredMessage = { id?: string; role: 'user' | 'assistant' | 'cancel'; content: string };

const cacheAIChatMessages = (messages: StoredMessage[], modeId?: ClientChatModeId) => {
  try {
    const key = chatStorageKey(modeId ?? store.state.activeChatMode);
    sessionStorage.setItem(key, JSON.stringify(messages));
  } catch {
    // sessionStorage full or unavailable — silently ignore
  }
};

const readCachedAIChatMessages = (modeId?: ClientChatModeId): StoredMessage[] | null => {
  try {
    const key = chatStorageKey(modeId ?? store.state.activeChatMode);
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // corrupt data — ignore
  }
  return null;
};

export const clearAIChatMessages = (modeId?: ClientChatModeId) => {
  try {
    const key = chatStorageKey(modeId ?? store.state.activeChatMode);
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
};

// Legacy aliases for backwards compat within this file
const cacheMachineConfigMessages = cacheAIChatMessages;
const readCachedMachineConfigMessages = readCachedAIChatMessages;
export const clearMachineConfigMessages = () => clearAIChatMessages('machine_config');

let cachedJwt: { token: string; expiresAt: number } | null = null;

const getJwt = async (): Promise<string | null> => {
  if (cachedJwt && Date.now() < cachedJwt.expiresAt) return cachedJwt.token;
  const { supabaseClient } = await import('../supabase/client');
  const session = await supabaseClient?.auth.getSession();
  const token = session?.data?.session?.access_token ?? null;
  if (token) cachedJwt = { token, expiresAt: Date.now() + 30_000 };
  return token;
};

/**
 * Fetches chat history from the server and populates state + sessionStorage cache.
 */
const fetchAIChatHistory = async (modeId?: ClientChatModeId): Promise<StoredMessage[] | null> => {
  try {
    const jwt = await getJwt();
    if (!jwt) return null;

    const mode = modeId ?? store.state.activeChatMode;
    const response = await fetch(`/api/chat/history/?mode=${encodeURIComponent(mode)}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!response.ok) return null;

    const data = await response.json();
    const messages = data.messages as StoredMessage[];
    if (Array.isArray(messages) && messages.length > 0) {
      cacheAIChatMessages(messages, modeId);
      return messages;
    }
  } catch {
    // Network error — fall through
  }
  return null;
};

const initAIChat = (messages: StoredMessage[], phase: 'idle' | 'waiting' = 'idle') => {
  const state = store.state;
  state.chat = {
    userPrompt: messages[0]?.content ?? '',
    assistantVisibleText: '',
    assistantFullText: '',
    stream: { initialDelayMs: 0, chunkSize: 1, intervalMs: 0 },
    isStreaming: false,
    ctaVisible: false,
    aiChat: {
      messages,
      phase,
    },
  };
  state.heroPhase = 'chat';
  store.notify();
};

/**
 * Validates the customer token against mac-mgmt via the server proxy.
 * Returns true if valid, false otherwise. On failure, clears the token from state.
 */
const verifyCustomerToken = async (): Promise<boolean> => {
  try {
    const jwt = await getJwt();
    if (!jwt) return false;
    const res = await fetch('/api/chat/verify-token/', {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.valid === true;
  } catch {
    return false;
  }
};

/**
 * Restores an AI chat session on page load.
 * - Shows cached messages instantly (sessionStorage)
 * - For machine_config: validates customer token against mac-mgmt
 * - Fetches authoritative history from server
 */
export const restoreAIChatSession = (): void => {
  const state = store.state;
  const mode = state.activeChatMode;

  // Machine config mode requires customer token
  if (mode === 'machine_config' && !state.customerToken) return;

  // Don't re-init if already active
  if (state.chat?.aiChat) return;

  // Instant restore from sessionStorage cache
  const cached = readCachedAIChatMessages(mode);
  if (cached && cached.length > 0) {
    initAIChat(cached);
  } else {
    const locale = locales[state.localeKey];
    const greeting = locale.chatModes[mode].greeting;
    initAIChat([]);
    if (greeting) {
      // Machine config: auto-send the greeting immediately
      // Use setTimeout to ensure sendChatMessage is available (defined later in file)
      setTimeout(() => void sendChatMessage(greeting), 0);
    } else {
      // Sales: show empty chat with composer (no greeting)
      store.notify();
    }
  }

  // Pre-connect EventSource eagerly
  void connectEvents();

  if (mode === 'machine_config') {
    const tokenValid = verifyCustomerToken();
    const historyFetch = fetchAIChatHistory(mode);

    void Promise.all([tokenValid, historyFetch]).then(([valid, serverMessages]) => {
      if (!valid) {
        // Token is invalid — tear down AI chat UI
        console.warn('[chat] Customer token invalid, disabling machine config');
        store.state.customerToken = null;
        if (store.state.chat?.aiChat) {
          store.state.chat.aiChat = undefined;
          store.state.heroPhase = 'composer';
        }
        clearAIChatMessages(mode);
        disconnectEvents();
        store.notify();
        return;
      }

      const mc = store.state.chat?.aiChat;
      if (!mc) return;

      if (serverMessages && serverMessages.length > 0) {
        const cancelLabel = locales[store.state.localeKey].chatModes[mode].cancelLabel;
        mc.messages = serverMessages.map((m) =>
          m.role === 'cancel' ? { ...m, content: m.content || cancelLabel } : m,
        );

        mc.phase = 'idle';
        store.state.chat!.userPrompt = serverMessages[0]?.content ?? '';
        store.notify();
      }
    });
  } else {
    // Non-machine-config modes: just fetch history
    void fetchAIChatHistory(mode).then((serverMessages) => {
      const mc = store.state.chat?.aiChat;
      if (!mc) return;

      if (serverMessages && serverMessages.length > 0) {
        const cancelLabel = locales[store.state.localeKey].chatModes[mode].cancelLabel;
        mc.messages = serverMessages.map((m) =>
          m.role === 'cancel' ? { ...m, content: m.content || cancelLabel } : m,
        );

        mc.phase = 'idle';
        store.state.chat!.userPrompt = serverMessages[0]?.content ?? '';
        store.notify();
      }
    });
  }
};

// Legacy alias
export const restoreMachineConfigSession = restoreAIChatSession;

// ─────────────────────────────────────────────────────────────────────────────
// AI Chat State Machine
//
// Phases: idle → waiting → streaming → question → waiting → ...
//                                    → idle (done)
//         any  → error
//
// transition() is the single entry point for all phase changes. It cleans up
// the previous phase (cancels streaming, clears question/error) before
// entering the new one, which prevents stale UI from leaking across phases.
// ─────────────────────────────────────────────────────────────────────────────

/** Persistent EventSource connection */
let eventSource: EventSource | null = null;

/** Whether the close was intentional (sign-out) — suppress reconnect */
let intentionalClose = false;

/** Reconnection backoff state */
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/** Pending delayed transition from tool → waiting */
let toolTransitionTimer: ReturnType<typeof setTimeout> | null = null;
const TOOL_TRANSITION_DELAY_MS = 500;

/**
 * Transition to a new phase, cleaning up any state from the previous one.
 * Always call this instead of setting phase/fields directly.
 */
const transition = (
  mc: NonNullable<typeof store.state.chat>['aiChat'],
  phase: 'idle' | 'waiting' | 'streaming' | 'tool' | 'question' | 'error',
) => {
  if (!mc) return;

  // Always cancel a pending tool→waiting transition
  if (toolTransitionTimer) {
    clearTimeout(toolTransitionTimer);
    toolTransitionTimer = null;
  }

  // Delay tool → waiting so the spinner doesn't flash to dots immediately
  if (mc.phase === 'tool' && phase === 'waiting') {
    toolTransitionTimer = setTimeout(() => {
      toolTransitionTimer = null;
      const cur = store.state.chat?.aiChat;
      if (cur?.phase === 'tool') {
        cur.phase = 'waiting';
        cur.toolName = undefined;
        store.notify();
      }
    }, TOOL_TRANSITION_DELAY_MS);
    return;
  }

  // Finalize any pending streaming text before leaving the phase
  if (mc.streamingText?.full) {
    mc.messages.push({ role: 'assistant', content: mc.streamingText.full });
    cacheAIChatMessages(mc.messages);
  }

  // Clear transient state from any previous phase
  mc.streamingText = undefined;
  mc.activeQuestion = undefined;
  mc.error = undefined;
  mc.toolName = undefined;

  mc.phase = phase;
};

// ─────────────────────────────────────────────────────────────────────────────
// Persistent EventSource — connection lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST a message/answer to the server. Events arrive via SSE.
 */
const postMessage = async (payload: { type: string; text: string }) => {
  const jwt = await getJwt();
  if (!jwt) return;

  const lang = document.documentElement.lang || navigator.language || 'en';
  const mode = store.state.activeChatMode;
  const res = await fetch(`/api/chat/message/?lang=${encodeURIComponent(lang)}&mode=${encodeURIComponent(mode)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (res.status === 409) {
    // Already processing in another tab — SSE will deliver events
    return;
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const mc = store.state.chat?.aiChat;
    if (mc) {
      transition(mc, 'error');
      mc.error = (data as any).error ?? 'Something went wrong';
      store.notify();
    }
  }
  // 202 — events arrive via EventSource
};

/**
 * Handles all server → client events from the SSE stream.
 */
const handleServerEvent = (type: string, data: Record<string, unknown>) => {
  console.log('[sse-client] Received:', type);
  const currentMc = store.state.chat?.aiChat;
  if (!currentMc) {
    console.warn('[sse-client] No aiChat in state, ignoring');
    return;
  }

  switch (type) {
    case 'thinking':
      transition(currentMc, 'waiting');
      store.notify();
      break;

    case 'text_delta': {
      const content: string = data.content as string;
      if (currentMc.phase !== 'streaming') {
        transition(currentMc, 'streaming');
        currentMc.streamingText = { full: '', visible: '' };
      }
      currentMc.streamingText!.full += content;
      currentMc.streamingText!.visible += content;
      store.notify();
      break;
    }

    case 'text_done': {
      const content: string = data.content as string;
      const mc2 = store.state.chat?.aiChat;
      if (mc2) {
        mc2.messages.push({ role: 'assistant', content });
        mc2.streamingText = undefined;
        cacheAIChatMessages(mc2.messages);
        store.notify();
      }
      break;
    }

    case 'tool_start':
      transition(currentMc, 'tool');
      currentMc.toolName = data.name as string;
      store.notify();
      break;

    case 'tool_end':
      transition(currentMc, 'waiting');
      store.notify();
      break;

    case 'question': {
      const mc2 = store.state.chat?.aiChat;
      if (!mc2) return;
      // Finalize any pending streaming text before showing question
      if (mc2.streamingText?.full) {
        mc2.messages.push({ role: 'assistant', content: mc2.streamingText.full });
      }
      mc2.streamingText = undefined;
      const lastMsg = mc2.messages[mc2.messages.length - 1];
      const alreadyDisplayed = lastMsg?.role === 'assistant' && lastMsg.content === (data.question as any)?.question;
      if (!alreadyDisplayed) {
        mc2.messages.push({ role: 'assistant', content: (data.question as any).question });
      }
      mc2.phase = 'question';
      mc2.activeQuestion = data.question as any;
      mc2.toolName = undefined;
      cacheAIChatMessages(mc2.messages);
      store.notify();
      break;
    }

    case 'done': {
      const mc2 = store.state.chat?.aiChat;
      if (mc2) {
        // Finalize any pending streaming text that wasn't closed by text_done
        if (mc2.streamingText?.full) {
          mc2.messages.push({ role: 'assistant', content: mc2.streamingText.full });
          mc2.streamingText = undefined;
        }
        mc2.phase = 'idle';
        mc2.toolName = undefined;
        cacheAIChatMessages(mc2.messages);
        store.notify();
      }
      break;
    }

    case 'error':
      transition(currentMc, 'error');
      currentMc.error = (data.message as string) ?? 'Something went wrong';
      store.notify();
      break;
  }
};

/** Promise that resolves when the current EventSource is open */
let connectPromise: Promise<void> | null = null;

/**
 * Opens a persistent EventSource connection for receiving server events.
 * Returns a promise that resolves when the connection is open.
 */
const connectEvents = (): Promise<void> => {
  if (eventSource?.readyState === EventSource.OPEN) return Promise.resolve();
  if (connectPromise) return connectPromise;

  intentionalClose = false;

  connectPromise = (async () => {
    try {
      const jwt = await getJwt();
      if (!jwt) return;

      const mode = store.state.activeChatMode;
      const es = new EventSource(`/api/chat/events/?token=${encodeURIComponent(jwt)}&mode=${encodeURIComponent(mode)}`);
      eventSource = es;

      // Register event listeners BEFORE waiting for open — avoids missing
      // events that arrive between onopen and listener registration
      const eventTypes = ['thinking', 'text_delta', 'text_done', 'tool_start', 'tool_end', 'question', 'done', 'error'];
      for (const type of eventTypes) {
        es.addEventListener(type, (event) => {
          try {
            const data = JSON.parse((event as MessageEvent).data);
            handleServerEvent(type, data);
          } catch (err) {
            console.error('[sse-client] Failed to parse event:', err);
          }
        });
      }

      await new Promise<void>((resolve) => {
        es.onopen = () => {
          console.log('[sse-client] EventSource connected');
          reconnectAttempt = 0;
          resolve();
        };

        // Also resolve on first error to avoid hanging forever
        const errorOnce = () => {
          es.removeEventListener('error', errorOnce);
          resolve();
        };
        es.addEventListener('error', errorOnce);
      });

      es.onerror = () => {
        console.warn('[sse-client] EventSource error/disconnected');
        if (eventSource === es) {
          eventSource = null;
          connectPromise = null;
          es.close();
        }

        if (!intentionalClose) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), 30_000);
          reconnectAttempt++;
          console.log(`[sse-client] Reconnecting in ${delay}ms (attempt ${reconnectAttempt})`);
          reconnectTimer = setTimeout(() => { void connectEvents(); }, delay);
        }
      };
    } catch (err) {
      console.error('[sse-client] Failed to connect:', err);
    } finally {
      connectPromise = null;
    }
  })();

  return connectPromise;
};

/**
 * Intentionally close the EventSource (sign-out). Suppresses reconnect.
 */
export const disconnectEvents = () => {
  intentionalClose = true;
  connectPromise = null;
  cachedJwt = null;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
};

export const sendChatMessage = async (message: string) => {
  const state = store.state;
  if (!state.chat?.aiChat || !state.userId) return;

  const mc = state.chat.aiChat;

  // If there's an active question, route as answer
  if (mc.phase === 'question') {
    answerChatQuestion(message);
    return;
  }

  transition(mc, 'waiting');
  mc.messages.push({ role: 'user', content: message });
  store.notify();

  // Ensure EventSource is connected before posting
  await connectEvents();

  // POST the message — events arrive via SSE
  void postMessage({ type: 'message', text: message });
};

// Legacy alias
export const sendMachineConfigMessage = sendChatMessage;

/**
 * Sends the user's answer to a pending question via POST.
 */
export const answerChatQuestion = async (text: string) => {
  const mc = store.state.chat?.aiChat;
  if (!mc) return;

  transition(mc, 'waiting');
  mc.messages.push({ role: 'user', content: text });
  cacheAIChatMessages(mc.messages);
  store.notify();

  await connectEvents();
  void postMessage({ type: 'answer', text });
};

// Legacy alias
export const answerMachineConfigQuestion = answerChatQuestion;

export const cancelChatQuestion = async () => {
  const mc = store.state.chat?.aiChat;
  if (!mc || mc.phase !== 'question') return;

  const mode = store.state.activeChatMode;
  const cancelLabel = locales[store.state.localeKey].chatModes[mode].cancelLabel;
  transition(mc, 'waiting');
  mc.messages.push({ role: 'cancel', content: cancelLabel });
  cacheAIChatMessages(mc.messages);
  store.notify();

  await connectEvents();
  void postMessage({ type: 'answer', text: '__cancel__' });
};

// Legacy alias
export const cancelMachineConfigQuestion = cancelChatQuestion;

/**
 * Switches the active chat mode. Disconnects current SSE, saves state,
 * switches mode, and restores/inits the new mode.
 */
export const switchChatMode = (newMode: ClientChatModeId): void => {
  const state = store.state;
  if (state.activeChatMode === newMode) return;

  // Machine config requires customer token
  if (newMode === 'machine_config' && !state.customerToken) return;

  // Disconnect current EventSource
  disconnectEvents();

  // Clear current chat state
  state.chat = null;
  state.heroPhase = 'composer';
  state.activeChatMode = newMode;
  store.notify();

  // Restore/init the new mode
  restoreAIChatSession();
};

export const startChatFromPrompt = (
  prompt: string,
  locale: LocaleContent,
  options?: StartPromptOptions,
) => {
  const state = store.state;

  // If restoring from a pre-auth state (e.g. OAuth return), force the anonymous plan
  // so we preserve the original "Invite" message context instead of replacing it
  // with the "Signed In" message. The "Signed In" message will appear in the postLogin area.
  const isRestoringPreAuth = options?.restoredFromChatCta;
  const plan = isRestoringPreAuth
    ? {
        type: 'anonymous' as const,
        scenarioId: 'anonymousInvite' as const,
        stepId: 'invite-intro',
      }
    : planPromptConversation(state, locale);

  // ─── AI Chat Mode (machine config, sales, newsletter) ──────────────────
  if (plan.type === 'aiChat') {
    // If already in an aiChat session (restored from server/cache),
    // just send the new message into the existing conversation
    if (state.chat?.aiChat) {
      void sendChatMessage(prompt);
      return;
    }

    state.chat = {
      userPrompt: prompt,
      assistantVisibleText: '',
      assistantFullText: '',
      stream: { initialDelayMs: 0, chunkSize: 1, intervalMs: 0 },
      isStreaming: false,
      ctaVisible: false,
      aiChat: {
        messages: [],
        phase: 'waiting',
      },
    };
    state.heroPhase = 'chat';
    store.notify();

    void sendChatMessage(prompt);
    return;
  }

  const inviteScenario = locale.conversationScenarios.anonymousInvite;
  const defaultStep = inviteScenario.steps[inviteScenario.entryStepId];
  let responseOverride = options?.responseOverride;
  let onStreamComplete = options?.onStreamComplete;
  let showCtas = options?.showCtas ?? false;
  let conversationPointer: ConversationPointer | null = null;
  let stepCta: StepCta | null = null;

  if (plan.type === 'anonymous') {
    const entry = getScenarioEntryStep(locale, plan.scenarioId, plan.stepId);
    if (entry) {
      conversationPointer = entry.pointer;
      stepCta = entry.step.cta ?? null;
      responseOverride = {
        text: entry.step.text,
        stream: entry.step.stream,
      };
    }
  } else if (plan.type === 'signedInSubscribed') {
    responseOverride = {
      text: plan.responseText,
      stream: defaultStep.stream,
    };
    onStreamComplete = options?.onStreamComplete;
  } else {
    responseOverride = {
      text: plan.responseText,
      stream: defaultStep.stream,
    };
    onStreamComplete = () => startNewsletterReconsiderFlow(locale);
  }

  const mergedOptions: StartPromptOptions = {
    ...options,
    showCtas,
    responseOverride,
    onStreamComplete,
    conversationPointer,
    cta: stepCta,
  };

  streamingController.startChatFromPrompt(prompt, locale, mergedOptions);
};

export const handlePromptSubmit = (value: string, locale: LocaleContent) => {
  const state = store.state;
  if (state.heroPhase !== 'composer') {
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }
  clearChatTimers();
  startChatFromPrompt(trimmed, locale, { animateHeroTransition: true });
  if (state.isAuthenticated && state.userId) {
    const promptRecord = createCachedPrompt(trimmed, state.localeKey);
    void persistPromptsToSupabase([promptRecord], state.localeKey).then(
      (didPersist) => {
        if (!didPersist) {
          appendPromptToCache(trimmed, state.localeKey, promptRecord);
          syncCachedPromptsToSupabase();
        }
      },
    );
  } else {
    appendPromptToCache(trimmed, state.localeKey);
  }
};

export const restoreChatSession = () => {
  const cached = readPreAuthState();

  // If no cache or already restored, exit.
  if (!cached || cached.restored) {
    return;
  }

  // If we have a cache but no pending auth, we normally exit.
  // However, if we are here, we should clean up pendingAuth if it exists but is false?
  // No, readPreAuthState returns null if empty.

  if (!cached.pendingAuth) {
    return;
  }

  const state = store.state;
  if (cached.localeKey !== state.localeKey) {
    store.setState({ localeKey: cached.localeKey });
  }
  const locale = locales[state.localeKey];
  const hasPrompts = cached.prompts.length > 0;
  // If we have prompts, we should treat this as a chat restoration regardless of
  // whether the auth trigger was the chat CTA or the nav bar.
  // This ensures we restore the "Invite" context and then trigger the post-login sequence.
  const restoredFromChat = hasPrompts;

  clearChatTimers();

  // Only restore the chat UI if we actually have prompts
  if (hasPrompts) {
    const lastPrompt = cached.prompts[cached.prompts.length - 1];
    startChatFromPrompt(lastPrompt.content, locale, {
      animateHeroTransition: false,
      skipStreaming: restoredFromChat,
      showCtas: true,
      restoredFromChatCta: restoredFromChat,
      enableBubbleAnimation: !restoredFromChat,
    });

    // Don't lock CTAs during restoration - we don't know yet if auth succeeded.
    // If user is authenticated, post-login flow will handle it.
    // If not, CTAs stay unlocked so user can try again with a different provider.
  }

  // Always mark as restored to prevent double-running
  updatePreAuthState({ restored: true, pendingAuth: false });

  // If we restored from chat (and thus have a prompt context),
  // we want to trigger the Post-Login Sequence (Newsletter)
  if (restoredFromChat && state.isAuthenticated && state.userEmail) {
    tryStartPostLoginSequence();
  }
};
