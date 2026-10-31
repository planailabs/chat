import { store } from '../app/store';
import type { LocaleContent } from '../content';
import type { ChatState } from '../app/state';

type NewsletterChoice = 'yes' | 'no';

type CTAState = Pick<ChatState, 'ctaVisible' | 'selectedCta' | 'isCtaLocked'>;

type NewsletterState = NonNullable<
  NonNullable<ChatState['postLogin']>['newsletter']
>;

const setChatCtaState = (updates: Partial<CTAState>) => {
  const state = store.state;
  if (!state.chat) {
    return;
  }
  state.chat = {
    ...state.chat,
    ...updates,
  };
  store.notify();
};

const selectAuthProvider = (provider: string) => {
  const state = store.state;
  if (!state.chat || state.chat.isCtaLocked) {
    return;
  }
  // Only set visual selection, don't lock - buttons stay clickable
  // until auth is confirmed (handles iOS back-navigation)
  setChatCtaState({ selectedCta: provider });
};

const lockAuthCtas = () => {
  // Lock CTAs when auth is confirmed - called from applySessionToState
  setChatCtaState({ isCtaLocked: true });
};

const resetAuthCtas = () => {
  setChatCtaState({ selectedCta: null, isCtaLocked: false });
};

const handleNewsletterChoice = (
  choice: NewsletterChoice,
  locale: LocaleContent,
) => {
  const state = store.state;
  const newsletterState = state.chat?.postLogin?.newsletter;
  if (!newsletterState || newsletterState.ctaLocked) {
    return;
  }
  const responseBubble =
    choice === 'yes'
      ? locale.newsletter.ctaYesLabel
      : locale.newsletter.ctaNoLabel;

  const next: NewsletterState = {
    ...newsletterState,
    response: choice,
    responseBubble,
    ctaLocked: true,
  };

  state.chat!.postLogin = {
    signedInBubbleVisible: state.chat!.postLogin?.signedInBubbleVisible ?? true,
    ...state.chat!.postLogin,
    newsletter: next,
  };
  store.notify();
};

export const ctaController = {
  selectAuthProvider,
  lockAuthCtas,
  resetAuthCtas,
  handleNewsletterChoice,
};
