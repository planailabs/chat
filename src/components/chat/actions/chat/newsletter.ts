/**
 * Chat Newsletter — newsletter flow: startNewsletterPrompt, handleChatNewsletterChoice,
 * startPostLoginSequence, startNewsletterReconsiderFlow, streaming helpers, timer state.
 */

import { store } from '../../app/store';
import {
  locales,
  type LocaleContent,
  type StreamConfig,
  type ConversationStep,
} from '../../content';
import {
  planPostLoginQuestion,
  getScenarioStep,
  getNextPointerFromCta,
  getScenarioEntryStep,
  type ConversationPointer,
  type CtaChoice,
} from '../../chat/conversationPlanner';
import { ctaController } from '../../chat/ctaController';
import { persistNewsletterChoice } from '../settings';
import { startCharacterStream } from '../../utils/stream';

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

// ─────────────────────────────────────────────────────────────────────────────
// Newsletter Question / Followup Streaming
// ─────────────────────────────────────────────────────────────────────────────

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
  if (state.profile.newsletterSyncing) {
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
