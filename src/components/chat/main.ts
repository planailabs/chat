import './style.css';
import { locales, type LocaleKey } from './content/index';
import { persistLocaleSelection } from './app/state';
import { renderHeader } from './ui/header';
import { renderSettingsOverlay } from './ui/settingsOverlay';
import { renderHeroSection, attachComposerInteractions } from './ui/hero';
import { renderChatSection } from './ui/chat';
import { initAuthController, type AuthProvider } from './auth/controller';
import { isSupabaseConfigured } from './supabase/client';
import { ctaController } from './chat/ctaController';
import { store } from './app/store';
import { delegateEvent } from './utils/dom';
import { streamingController } from './chat/streaming';

// Actions
import {
  applySessionToState,
  launchOAuthFlow,
  handleSignOut,
} from './actions/auth';
import {
  handleSettingsNewsletterToggle,
  requestAccountDeletion,
  handleDataExport,
} from './actions/settings';
import {
  handleChatNewsletterChoice,
  handlePromptSubmit,
  restoreChatSession,
  restoreAIChatSession,
  sendChatMessage,
  answerChatQuestion,
  cancelChatQuestion,
  switchChatMode,
  answerPreferencePrompt,
} from './actions/chat';
import type { ClientChatModeId } from './constants';
import { persistLanguagePreference } from './actions/profile';
import { openSettingsOverlay, closeSettingsOverlay } from './actions/overlay';
import { initTheme, cycleThemeMode } from './actions/theme';

const initApp = () => {
  const app = document.querySelector<HTMLDivElement>('#app');

  // Initialization of layout structure
  if (app) {
    app.innerHTML = `
    <div class="app-shell flex flex-col bg-(--surface-base) text-(--text-primary)">
      <div id="header-region" class="shrink-0"></div>

      <main id="main-region" class="flex min-h-0 flex-1 flex-col items-center px-6"></main>

      <footer id="footer-region" class="shrink-0 px-4 py-3 text-center text-xs text-(--text-muted) md:px-6 md:py-4"></footer>
    </div>
    <div id="overlay-region"></div>
  `;
  }

  const headerRegion = app?.querySelector('#header-region') as HTMLElement;
  const mainRegion = app?.querySelector('#main-region') as HTMLElement;
  const footerRegion = app?.querySelector('#footer-region') as HTMLElement;
  const overlayRegion = app?.querySelector('#overlay-region') as HTMLElement;

  // Subscriptions
  store.subscribe(render);

  function render() {
    if (!app) {
      return;
    }
    const state = store.state;
    const locale = locales[state.localeKey];

    // 1. Update Header
    if (headerRegion) {
      headerRegion.innerHTML = renderHeader({ locale, state });
    }

    // 2. Update Main Region (Hero or Chat)
    if (mainRegion) {
      const isChat = state.heroPhase === 'chat';
      const isChatEmpty =
        isChat && state.chat?.aiChat?.messages.length === 0;
      // Empty chat (e.g. sales initial): use justify-center to vertically center content
      // Chat with messages: use pt-10 and start from top with scrollable content
      const mainClasses =
        !isChat || isChatEmpty
          ? 'flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-6'
          : 'flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pt-10 pb-6';

      if (mainRegion.className !== mainClasses) {
        mainRegion.className = mainClasses;
      }

      if (isChat) {
        // Update Chat
        mainRegion.innerHTML = renderChatSection(locale, state);
        // Auto-scroll to bottom during streaming, waiting, or just after
        const mc = state.chat?.aiChat;
        if (mc?.phase === 'streaming' || mc?.phase === 'waiting'
          || mc?.phase === 'idle' || mc?.phase === 'question' || mc?.phase === 'login') {
          mainRegion.scrollTop = mainRegion.scrollHeight;
        }
      } else {
        // Update Hero
        const heroMarkup = renderHeroSection(locale, state);
        if (mainRegion.innerHTML !== heroMarkup) {
          mainRegion.innerHTML = heroMarkup;
          // Re-attach specific hero interactions that can't be easily delegated
          attachComposerInteractions(app, locale, state, (value) =>
            handlePromptSubmit(value, locale),
          );
        }
      }
    }

    // 3. Update Footer
    if (footerRegion) {
      const footerMarkup = locale.footer.consent
        .replace(
          locale.footer.termsLabel,
          `<a class="font-semibold" href="${locale.footer.termsUrl}">${locale.footer.termsLabel}</a>`,
        )
        .replace(
          locale.footer.privacyLabel,
          `<a class="font-semibold" href="${locale.footer.privacyUrl}">${locale.footer.privacyLabel}</a>`,
        );

      if (footerRegion.innerHTML !== footerMarkup) {
        footerRegion.innerHTML = footerMarkup;
      }
    }

    // 4. Update Overlay
    if (overlayRegion) {
      const overlayMarkup = renderSettingsOverlay({ state, locale });
      if (overlayRegion.innerHTML !== overlayMarkup) {
        overlayRegion.innerHTML = overlayMarkup;
      }
    }

    // Reset animations after render
    streamingController.scheduleBubbleAnimationReset();
  }

  // --- Event Delegation Setup ---

  if (app) {
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

    // Header: Stop Impersonation (navigates to home, removing ?impersonate param)
    delegateEvent(app, 'click', '[data-action="stop-impersonation"]', (event) => {
      event.stopPropagation();
      store.setState({ isAuthMenuOpen: false });
      window.location.href = '/';
    });

    // Global: Close Menus on click outside
    document.addEventListener('click', (event) => {
      const target = event.target as Node | null;
      const languageMenu = document.querySelector('[data-menu="language"]');
      const authMenu = document.querySelector('[data-menu="auth"]');
      const modeMenu = document.querySelector('[data-menu="mode-switcher"]');
      const state = store.state;

      let updates: Partial<typeof state> = {};
      let hasUpdates = false;

      if (
        state.isLanguageMenuOpen &&
        languageMenu &&
        !languageMenu.contains(target)
      ) {
        updates.isLanguageMenuOpen = false;
        hasUpdates = true;
      }
      if (state.isAuthMenuOpen && authMenu && !authMenu.contains(target)) {
        updates.isAuthMenuOpen = false;
        hasUpdates = true;
      }

      // Close mode switcher dropdown on outside click
      if (modeMenu && !modeMenu.contains(target)) {
        const dropdown = modeMenu.querySelector<HTMLElement>('[data-mode-dropdown]');
        if (dropdown && !dropdown.classList.contains('hidden')) {
          dropdown.classList.add('hidden');
        }
      }

      if (hasUpdates) {
        store.setState(updates);
      }
    });

    // Chat: Login Invite OAuth (anonymous sales chat sign-in)
    delegateEvent(
      app,
      'click',
      '[data-action="login-invite-oauth"]',
      (event, target) => {
        event.stopPropagation();
        const provider = target.getAttribute('data-provider') as AuthProvider | null;
        const invite = store.state.chat?.aiChat?.loginInvite;
        if (!provider || !invite || invite.ctaLocked) return;
        // Lock CTAs and show selected state
        invite.ctaLocked = true;
        invite.selectedProvider = provider;
        store.notify();
        void launchOAuthFlow(provider, 'chat');
      },
    );

    // Chat: OAuth
    delegateEvent(
      app,
      'click',
      '[data-action="chat-oauth"]',
      (event, target) => {
        event.stopPropagation();
        const provider = target.getAttribute(
          'data-provider',
        ) as AuthProvider | null;
        const state = store.state;
        const chat = state.chat;
        if (!provider || !chat || chat.isCtaLocked) {
          return;
        }
        ctaController.selectAuthProvider(provider);
        void launchOAuthFlow(provider, 'chat');
      },
    );

    // Chat: Machine Config — helpers for contenteditable input
    const getMachineConfigInput = () =>
      app.querySelector<HTMLElement>('[data-action="machine-config-input"]');

    const getMachineConfigValue = (input: HTMLElement): string =>
      (input.textContent ?? '').trim();

    const clearMachineConfigInput = (input: HTMLElement) => {
      input.textContent = '';
      input.setAttribute('data-empty', 'true');
      const btn = app.querySelector<HTMLButtonElement>(
        '[data-action="machine-config-send"]',
      );
      if (btn) {
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
      }
    };

    // Chat: Machine Config Send
    delegateEvent(
      app,
      'click',
      '[data-action="machine-config-send"]',
      () => {
        const input = getMachineConfigInput();
        if (!input) return;
        const value = getMachineConfigValue(input);
        if (!value) return;
        clearMachineConfigInput(input);
        void sendChatMessage(value);
      },
    );

    // Chat: Machine Config Enter Key
    delegateEvent(
      app,
      'keydown',
      '[data-action="machine-config-input"]',
      (event) => {
        const keyEvent = event as KeyboardEvent;
        if (keyEvent.key !== 'Enter') return;
        keyEvent.preventDefault();
        const input = keyEvent.target as HTMLElement;
        const value = getMachineConfigValue(input);
        if (!value) return;
        clearMachineConfigInput(input);
        void sendChatMessage(value);
      },
    );

    // Chat: Machine Config — sync empty state and send button
    delegateEvent(
      app,
      'input',
      '[data-action="machine-config-input"]',
      (event) => {
        const input = event.target as HTMLElement;
        const hasContent = (input.textContent ?? '').trim().length > 0;
        input.setAttribute('data-empty', hasContent ? 'false' : 'true');
        const btn = app.querySelector<HTMLButtonElement>(
          '[data-action="machine-config-send"]',
        );
        if (btn) {
          btn.disabled = !hasContent;
          btn.setAttribute('aria-disabled', String(!hasContent));
        }
      },
    );

    // Chat: Machine Config — Question Choice (multiple-choice buttons)
    delegateEvent(
      app,
      'click',
      '[data-action="mc-question-choice"]',
      (event, target) => {
        event.stopPropagation();
        const choice = target.getAttribute('data-choice');
        if (!choice) return;
        // Visual feedback: mark selected, briefly disable all
        target.classList.add('is-selected');
        const allButtons = app.querySelectorAll<HTMLButtonElement>(
          '[data-action="mc-question-choice"], [data-action="mc-question-cancel"]',
        );
        allButtons.forEach((btn) => {
          btn.disabled = true;
          btn.classList.add('is-disabled');
        });
        setTimeout(() => {
          answerChatQuestion(choice);
        }, 200);
      },
    );

    // Chat: Machine Config — Cancel Question
    delegateEvent(
      app,
      'click',
      '[data-action="mc-question-cancel"]',
      (event) => {
        event.stopPropagation();
        cancelChatQuestion();
      },
    );

    // Chat: Preference Prompt Choice (Yes/No from prompt_preference tool)
    delegateEvent(
      app,
      'click',
      '[data-action="preference-choice"]',
      (event, target) => {
        event.stopPropagation();
        const choice = target.getAttribute('data-choice');
        if (choice === 'yes' || choice === 'no') {
          answerPreferencePrompt(choice);
        }
      },
    );

    // Chat: Mode Switcher Toggle
    delegateEvent(
      app,
      'click',
      '[data-action="mode-switcher-toggle"]',
      (event) => {
        event.stopPropagation();
        const dropdown = app.querySelector<HTMLElement>('[data-mode-dropdown]');
        if (dropdown) {
          dropdown.classList.toggle('hidden');
        }
      },
    );

    // Chat: Mode Switch
    delegateEvent(
      app,
      'click',
      '[data-action="switch-chat-mode"]',
      (event, target) => {
        event.stopPropagation();
        const modeId = target.getAttribute('data-mode') as ClientChatModeId | null;
        if (modeId) {
          const dropdown = app.querySelector<HTMLElement>('[data-mode-dropdown]');
          if (dropdown) dropdown.classList.add('hidden');
          switchChatMode(modeId);
        }
      },
    );

    // Chat: Newsletter Choice
    delegateEvent(
      app,
      'click',
      '[data-action="newsletter-choice"]',
      (event, target) => {
        event.stopPropagation();
        const choice = target.getAttribute('data-choice');
        if (choice === 'yes' || choice === 'no') {
          handleChatNewsletterChoice(choice);
        }
      },
    );

    // Settings: Close
    delegateEvent(app, 'click', '[data-action="close-settings"]', (event) => {
      event.preventDefault();
      closeSettingsOverlay();
    });

    // Settings: Sign Out
    delegateEvent(app, 'click', '[data-action="overlay-sign-out"]', (event) => {
      event.preventDefault();
      closeSettingsOverlay();
      void handleSignOut();
    });

    // Settings: Delete Account
    delegateEvent(app, 'click', '[data-action="delete-account"]', (event) => {
      event.preventDefault();
      const state = store.state;
      const locale = locales[state.localeKey];
      requestAccountDeletion(locale);
    });

    // Settings: Request Data
    delegateEvent(app, 'click', '[data-action="request-data"]', (event) => {
      event.preventDefault();
      const state = store.state;
      const locale = locales[state.localeKey];
      handleDataExport(locale);
    });

    // Settings: Newsletter Toggle
    delegateEvent(
      app,
      'change',
      '[data-setting="newsletter-opt-in"]',
      (event, target) => {
        const input = target as HTMLInputElement;
        handleSettingsNewsletterToggle(input.checked);
      },
    );
  }

  // Initialization
  initTheme();
  if (isSupabaseConfigured) {
    initAuthController(applySessionToState);
  } else {
    console.warn(
      '[auth] Supabase not configured — set VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY to enable sign-in.',
    );
  }

  restoreChatSession();
  restoreAIChatSession();
  store.notify(); // Initial render via subscription (since render is subscribed)
  // We can also explicitly call render() if store.subscribe doesn't fire on init
  // But subscribe only fires on changes. So we do need an initial render.
  render();

  // Trigger fade-in effect (on load/refresh, not OAuth redirect)
  // This runs after the initial render is complete
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.remove('is-first-visit');
    });
  });
};

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
}
