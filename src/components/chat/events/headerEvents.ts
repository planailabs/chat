import { store } from '../app/store';
import { delegateEvent } from '../utils/dom';
import { cycleThemeMode } from '../actions/theme';
import { locales, type LocaleKey } from '../content/index';
import { persistLocaleSelection } from '../app/state';
import { persistLanguagePreference } from '../actions/profile';
import { launchOAuthFlow, handleSignOut } from '../actions/auth';
import type { AuthProvider } from '../auth/controller';
import { openSettingsOverlay } from '../actions/overlay';
import { nukeChat } from '../actions/chat';

export const registerHeaderEvents = (app: HTMLElement) => {
  // Header: Theme Toggle
  delegateEvent(app, 'click', '[data-action="theme-toggle"]', () => {
    cycleThemeMode();
    // Persist handled inside setThemeMode now, but we can trigger profile sync if needed.
    // cycleThemeMode in actions/theme.ts calls persistProfilePreferences internally.
  });

  // Header: Language Toggle
  delegateEvent(app, 'click', '[data-action="language-toggle"]', (event) => {
    event.stopPropagation();
    const state = store.state;
    store.setState({
      isAuthMenuOpen: false,
      isLanguageMenuOpen: !state.isLanguageMenuOpen,
    });
  });

  // Header: Language Selection
  delegateEvent(
    app,
    'click',
    '[data-action="language-select"]',
    (event, target) => {
      event.stopPropagation();
      const selectedLocale = target.getAttribute('data-locale') as LocaleKey;
      const state = store.state;
      if (selectedLocale && selectedLocale !== state.localeKey) {
        store.setState({
          localeKey: selectedLocale,
          isLanguageMenuOpen: false,
        });
        persistLocaleSelection(selectedLocale);
        persistLanguagePreference(selectedLocale);
      } else {
        store.setState({ isLanguageMenuOpen: false });
      }
    },
  );

  // Header: Auth Toggle
  delegateEvent(app, 'click', '[data-action="auth-toggle"]', (event) => {
    event.stopPropagation();
    const state = store.state;
    store.setState({
      isLanguageMenuOpen: false,
      isAuthMenuOpen: !state.isAuthMenuOpen,
    });
  });

  // Header: OAuth Provider Click
  delegateEvent(
    app,
    'click',
    '[data-action="oauth-provider"]',
    (event, target) => {
      event.stopPropagation();
      const provider = target.getAttribute(
        'data-provider',
      ) as AuthProvider | null;
      store.setState({ isAuthMenuOpen: false });
      if (provider) {
        void launchOAuthFlow(provider, 'nav');
      }
    },
  );

  // Header: User Menu Toggle
  delegateEvent(app, 'click', '[data-action="user-menu-toggle"]', (event) => {
    event.stopPropagation();
    const state = store.state;
    store.setState({
      isLanguageMenuOpen: false,
      isAuthMenuOpen: !state.isAuthMenuOpen,
    });
  });

  // Header: Settings Link
  delegateEvent(app, 'click', '[data-action="settings-link"]', (event) => {
    event.stopPropagation();
    store.setState({ isAuthMenuOpen: false });
    openSettingsOverlay();
  });

  // Header: Sign Out
  delegateEvent(app, 'click', '[data-action="sign-out"]', (event) => {
    event.stopPropagation();
    store.setState({ isAuthMenuOpen: false });
    void handleSignOut();
  });

  // Header: Nuke Chat (dev only)
  delegateEvent(app, 'click', '[data-action="nuke-chat"]', (event) => {
    event.stopPropagation();
    store.setState({ isAuthMenuOpen: false });
    void nukeChat();
  });

  // Header: Stop Impersonation (navigates to home, removing ?impersonate param)
  delegateEvent(app, 'click', '[data-action="stop-impersonation"]', (event) => {
    event.stopPropagation();
    store.setState({ isAuthMenuOpen: false });
    window.location.href = '/';
  });
};
