/**
 * Chat Preference — answerPreferencePrompt, preference streaming helpers.
 */

import { store } from '../../app/store';
import { locales } from '../../content';
import { startCharacterStream } from '../../utils/stream';
import { cacheAIChatMessages } from './cache';
import { answerChatQuestion } from './stateMachine';

// ─────────────────────────────────────────────────────────────────────────────
// Preference Prompt Timers (for prompt_preference tool)
// ─────────────────────────────────────────────────────────────────────────────
export let preferenceQuestionStreamCancel: (() => void) | null = null;
export let preferenceFollowupStreamCancel: (() => void) | null = null;

export const clearPreferenceTimers = () => {
  if (preferenceQuestionStreamCancel) {
    preferenceQuestionStreamCancel();
    preferenceQuestionStreamCancel = null;
  }
  if (preferenceFollowupStreamCancel) {
    preferenceFollowupStreamCancel();
    preferenceFollowupStreamCancel = null;
  }
};

export const locale = () => locales[store.state.localeKey];

export const startPreferenceQuestionStream = () => {
  const pref = store.state.chat?.aiChat?.clientPrompt?.preference;
  if (!pref) return;

  if (preferenceQuestionStreamCancel) {
    preferenceQuestionStreamCancel();
    preferenceQuestionStreamCancel = null;
  }

  const totalLength = pref.questionText.length;
  preferenceQuestionStreamCancel = startCharacterStream(
    totalLength,
    pref.stream.chunkSize,
    pref.stream.intervalMs,
    (index) => {
      const curPref = store.state.chat?.aiChat?.clientPrompt?.preference;
      if (!curPref) return;
      curPref.visibleQuestionText = curPref.questionText.slice(0, index);
      store.notify();
    },
    () => {
      preferenceQuestionStreamCancel = null;
      const curPref = store.state.chat?.aiChat?.clientPrompt?.preference;
      if (!curPref) return;
      curPref.visibleQuestionText = curPref.questionText;
      curPref.subPhase = 'awaiting_choice';
      store.notify();
    },
  );
};

const startPreferenceFollowupStream = () => {
  const pref = store.state.chat?.aiChat?.clientPrompt?.preference;
  if (!pref || !pref.followupText) return;

  if (preferenceFollowupStreamCancel) {
    preferenceFollowupStreamCancel();
    preferenceFollowupStreamCancel = null;
  }

  const totalLength = pref.followupText.length;
  preferenceFollowupStreamCancel = startCharacterStream(
    totalLength,
    pref.stream.chunkSize,
    pref.stream.intervalMs,
    (index) => {
      const curPref = store.state.chat?.aiChat?.clientPrompt?.preference;
      if (!curPref || !curPref.followupText) return;
      curPref.visibleFollowupText = curPref.followupText.slice(0, index);
      store.notify();
    },
    () => {
      preferenceFollowupStreamCancel = null;
      const curPref = store.state.chat?.aiChat?.clientPrompt?.preference;
      if (!curPref) return;
      curPref.visibleFollowupText = curPref.followupText;
      curPref.subPhase = 'done';
      store.notify();

      // After follow-up completes, add exchange to messages and send answer to server
      const mc = store.state.chat?.aiChat;
      if (!mc || !curPref) return;
      mc.messages.push({ role: 'assistant', content: curPref.questionText });
      const choiceLabel = curPref.choice === 'yes' ? locale().newsletter.ctaYesLabel : locale().newsletter.ctaNoLabel;
      mc.messages.push({ role: 'user', content: choiceLabel });
      mc.messages.push({ role: 'assistant', content: curPref.followupText! });
      cacheAIChatMessages(mc.messages);

      const answerText = curPref.choice === 'yes' ? 'subscribed' : 'declined';
      void answerChatQuestion(answerText);
    },
  );
};

export const answerPreferencePrompt = (choice: 'yes' | 'no') => {
  const pref = store.state.chat?.aiChat?.clientPrompt?.preference;
  if (!pref || pref.subPhase !== 'awaiting_choice') return;

  // Lock buttons and set choice
  pref.ctaLocked = true;
  pref.choice = choice;
  pref.subPhase = 'persisting';
  store.notify();

  // Persist newsletter preference
  const userId = store.state.userId;
  if (!userId) return;

  const subscribe = choice === 'yes';
  void (async () => {
    try {
      const { persistNewsletterPreference } = await import('../../supabase/newsletter');
      await persistNewsletterPreference({
        userId,
        localeKey: store.state.localeKey,
        subscribe,
        source: 'chat_flow',
      });
    } catch (err) {
      console.warn('[chat] Failed to persist newsletter preference:', err);
    }

    // Stream follow-up text
    const curPref = store.state.chat?.aiChat?.clientPrompt?.preference;
    if (!curPref) return;

    const prefId = store.state.chat?.aiChat?.clientPrompt?.input.preference_id as string;
    const prefContent = locale().preferencePrompts[prefId];
    if (!prefContent) return;

    curPref.followupText = choice === 'yes' ? prefContent.confirmText : prefContent.declineText;
    curPref.visibleFollowupText = '';
    curPref.subPhase = 'streaming_followup';
    store.notify();

    setTimeout(() => startPreferenceFollowupStream(), curPref.stream.initialDelayMs);
  })();
};
