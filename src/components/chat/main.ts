import './style.css';
import { locales } from './content/index';
import { renderHeader } from './ui/header';
import { renderSettingsOverlay } from './ui/settingsOverlay';
import { renderHeroSection, attachComposerInteractions } from './ui/hero';
import { renderChatSection } from './ui/chat';
import { initAuthController } from './auth/controller';
import { isSupabaseConfigured } from './supabase/client';
import { store } from './app/store';
import { streamingController } from './chat/streaming';

// Actions
import { applySessionToState } from './actions/auth';
import { handlePromptSubmit, restoreChatSession, restoreAIChatSession } from './actions/chat';
import { initTheme } from './actions/theme';

import { registerAllEvents } from './events';

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
    registerAllEvents(app);
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
