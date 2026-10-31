/**
 * Chat Preference — the prompt_preference tool: a scripted yes/no question
 * streamed in the UI language, the choice saved to the profile, a follow-up,
 * then the answer for the assistant.
 */

import { store } from '../../app/store';
import { locales } from '../../content';
import { startCharacterStream } from '../../utils/stream';
import { persistNewsletterChoice } from '../profile';
import { answerPreference } from './stateMachine';

const locale = () => locales[store.state.localeKey];

let questionStreamCancel: (() => void) | null = null;
let followupStreamCancel: (() => void) | null = null;

export const clearPreferenceTimers = () => {
  questionStreamCancel?.();
  questionStreamCancel = null;
  followupStreamCancel?.();
  followupStreamCancel = null;
};

const currentPreference = () => store.state.chat?.clientPrompt?.preference;

export const startPreferenceQuestionStream = () => {
  const pref = currentPreference();
  if (!pref) return;
  questionStreamCancel?.();
  questionStreamCancel = startCharacterStream(
    pref.questionText.length,
    pref.stream.chunkSize,
    pref.stream.intervalMs,
    (index) => {
      const cur = currentPreference();
      if (!cur) return;
      cur.visibleQuestionText = cur.questionText.slice(0, index);
      store.notify();
    },
    () => {
      questionStreamCancel = null;
      const cur = currentPreference();
      if (!cur) return;
      cur.visibleQuestionText = cur.questionText;
      cur.subPhase = 'awaiting_choice';
      store.notify();
    },
  );
};

const startPreferenceFollowupStream = () => {
  const pref = currentPreference();
  if (!pref?.followupText) return;
  followupStreamCancel?.();
  followupStreamCancel = startCharacterStream(
    pref.followupText.length,
    pref.stream.chunkSize,
    pref.stream.intervalMs,
    (index) => {
      const cur = currentPreference();
      if (!cur?.followupText) return;
      cur.visibleFollowupText = cur.followupText.slice(0, index);
      store.notify();
    },
    () => {
      followupStreamCancel = null;
      const prompt = store.state.chat?.clientPrompt;
      const cur = prompt?.preference;
      if (!prompt || !cur?.followupText || !cur.choice) return;
      cur.visibleFollowupText = cur.followupText;
      cur.subPhase = 'done';
      store.notify();

      // The exchange stays in the conversation; the assistant gets the answer.
      const prefLocale = locale().preferencePrompts[prompt.input.preference_id as string];
      void answerPreference(cur.choice, [
        { role: 'assistant', content: cur.questionText },
        { role: 'user', content: cur.choice === 'yes' ? prefLocale.ctaYesLabel : prefLocale.ctaNoLabel },
        { role: 'assistant', content: cur.followupText },
      ]);
    },
  );
};

export const answerPreferencePrompt = (choice: 'yes' | 'no') => {
  const prompt = store.state.chat?.clientPrompt;
  const pref = prompt?.preference;
  if (!prompt || !pref || pref.subPhase !== 'awaiting_choice') return;

  pref.ctaLocked = true;
  pref.choice = choice;
  pref.subPhase = 'persisting';
  store.notify();

  void (async () => {
    // newsletter is the only preference the profile stores
    if (prompt.input.preference_id === 'newsletter') {
      await persistNewsletterChoice(choice === 'yes', 'chat_flow');
    }

    const cur = currentPreference();
    const prefContent = locale().preferencePrompts[prompt.input.preference_id as string];
    if (!cur || !prefContent) return;

    cur.followupText = choice === 'yes' ? prefContent.confirmText : prefContent.declineText;
    cur.visibleFollowupText = '';
    cur.subPhase = 'streaming_followup';
    store.notify();

    setTimeout(() => startPreferenceFollowupStream(), cur.stream.initialDelayMs);
  })();
};
