import { store } from '../app/store';
import type { LocaleContent, StepCta, StreamConfig } from '../content';
import type { ConversationPointer } from './conversationPlanner';
import { startCharacterStream } from '../utils/stream';

type TimeoutId = ReturnType<typeof setTimeout> | null;

export interface StartPromptOptions {
  animateHeroTransition?: boolean;
  skipStreaming?: boolean;
  showCtas?: boolean;
  restoredFromChatCta?: boolean;
  enableBubbleAnimation?: boolean;
  onStreamComplete?: () => void;
  responseOverride?: {
    text: string;
    stream: StreamConfig;
  };
  cta?: StepCta | null;
  conversationPointer?: ConversationPointer | null;
}

let heroFadeTimeout: TimeoutId = null;
let streamDelayTimeout: TimeoutId = null;
let streamCancel: (() => void) | null = null;
let streamCompleteCallback: (() => void) | null = null;

const runStreamCompleteCallback = () => {
  if (streamCompleteCallback) {
    const callback = streamCompleteCallback;
    streamCompleteCallback = null;
    callback();
  }
};

const startAssistantStream = () => {
  const state = store.state;
  if (!state.chat) {
    return;
  }
  const { assistantFullText, stream } = state.chat;
  const totalLength = assistantFullText.length;

  if (streamDelayTimeout) {
    clearTimeout(streamDelayTimeout);
    streamDelayTimeout = null;
  }
  if (streamCancel) {
    streamCancel();
    streamCancel = null;
  }

  const run = () => {
    if (!state.chat) {
      return;
    }

    streamCancel = startCharacterStream(
      totalLength,
      state.chat.stream.chunkSize,
      state.chat.stream.intervalMs,
      (index) => {
        if (!state.chat) return;
        state.chat.assistantVisibleText = assistantFullText.slice(0, index);
        store.notify();
      },
      () => {
        streamCancel = null;
        if (!state.chat) return;

        state.chat.isStreaming = false;
        store.notify();
        setTimeout(() => {
          if (!state.chat || !state.chat.cta || state.chat.ctaVisible) {
            return;
          }
          state.chat.ctaRevealStyle = 'fade';
          state.chat.ctaVisible = true;
          store.notify();
          if (state.chat) {
            state.chat.ctaRevealStyle = 'instant';
          }
        }, 200);
        runStreamCompleteCallback();
      },
    );
  };

  streamDelayTimeout = setTimeout(run, stream.initialDelayMs);
};

const startChatFromPrompt = (
  prompt: string,
  locale: LocaleContent,
  options?: StartPromptOptions,
) => {
  const state = store.state;
  const animateBubbles = options?.enableBubbleAnimation ?? true;
  const defaultStep =
    locale.conversationScenarios.anonymousInvite.steps['invite-intro'];
  const response = options?.responseOverride ?? defaultStep;
  streamCompleteCallback = options?.onStreamComplete ?? null;
  const shouldShowCtasImmediately = options?.showCtas ?? false;
  state.chat = {
    userPrompt: prompt,
    assistantVisibleText: '',
    assistantFullText: response.text,
    stream: response.stream,
    isStreaming: true,
    ctaVisible: shouldShowCtasImmediately,
    ctaRevealStyle: shouldShowCtasImmediately ? 'instant' : undefined,
    selectedCta: null,
    isCtaLocked: false,
    userBubbleJustAppeared: animateBubbles,
    assistantBubbleJustAppeared: animateBubbles,
    restoredFromChatCta: options?.restoredFromChatCta,
    cta: options?.cta ?? undefined,
    conversation: options?.conversationPointer ?? undefined,
  };
  store.notify();

  const launch = () => {
    state.heroPhase = 'chat';
    store.notify();
    if (!options?.skipStreaming) {
      startAssistantStream();
    } else if (state.chat) {
      state.chat.assistantVisibleText = state.chat.assistantFullText;
      state.chat.isStreaming = false;
      runStreamCompleteCallback();
    }
  };

  if (options?.animateHeroTransition) {
    if (heroFadeTimeout) {
      clearTimeout(heroFadeTimeout);
    }
    heroFadeTimeout = setTimeout(launch, 50);
  } else {
    launch();
  }
};

const scheduleBubbleAnimationReset = () => {
  const state = store.state;
  if (!state.chat || state.heroPhase !== 'chat') {
    return;
  }
  const hasPendingAnimation =
    state.chat.userBubbleJustAppeared ||
    state.chat.assistantBubbleJustAppeared ||
    Boolean(state.chat.postLogin?.signedInBubbleJustAppeared);
  if (!hasPendingAnimation) {
    return;
  }
  setTimeout(() => {
    if (!state.chat) {
      return;
    }
    const raf =
      typeof window !== 'undefined' && window.requestAnimationFrame
        ? window.requestAnimationFrame.bind(window)
        : (cb: FrameRequestCallback) => setTimeout(cb, 0);
    raf(() => {
      if (!state.chat) {
        return;
      }
      state.chat.userBubbleJustAppeared = false;
      state.chat.assistantBubbleJustAppeared = false;
      if (state.chat.postLogin?.signedInBubbleJustAppeared) {
        state.chat.postLogin.signedInBubbleJustAppeared = false;
      }
    });
  }, 0);
};

export const streamingController = {
  startChatFromPrompt,
  scheduleBubbleAnimationReset,
};
