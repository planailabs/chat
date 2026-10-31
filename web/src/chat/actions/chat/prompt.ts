/**
 * Chat Prompt — handlePromptSubmit, startChatFromPrompt, restoreChatSession.
 */

import { store } from '../../app/store';
import { locales, type LocaleContent } from '../../content';
import {
  planPromptConversation,
  getScenarioEntryStep,
  type ConversationPointer,
} from '../../chat/conversationPlanner';
import {
  streamingController,
  type StartPromptOptions,
} from '../../chat/streaming';
import {
  createCachedPrompt,
  appendPromptToCache,
  readPreAuthState,
  updatePreAuthState,
} from '../../auth/preAuthCache';
import {
  persistPromptsToSupabase,
  syncCachedPromptsToSupabase,
} from '../messages';
import { readPendingSalesPrompt } from './cache';
import { startNewsletterReconsiderFlow, clearChatTimers } from './newsletter';
import { sendChatMessage } from './stateMachine';
import { tryStartPostLoginSequence } from './newsletter';

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
  let stepCta = null;

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

  // If there's a pending sales prompt, skip conversation planner restoration —
  // the aiChat state machine handles the full flow (login invite + post-login send).
  if (readPendingSalesPrompt()) {
    return;
  }

  // If we have a cache but no pending auth, we normally exit.
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
