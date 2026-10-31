import './style.css';
import { locales } from './content/index';
import { renderHeader } from './ui/header';
import { renderSettingsOverlay } from './ui/settingsOverlay';
import { renderChatSection } from './ui/chat';
import { store } from './app/store';

// Actions
import { startSession } from './actions/auth';
import { showCachedChat } from './actions/chat';
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

    // 2. Update Main Region (the chat; empty, it is the hero)
    if (mainRegion) {
      const mc = state.chat;
      const isEmpty = !mc || mc.messages.length === 0;
      // Empty chat: content vertically centered.
      // Chat with messages: starts from the top and scrolls.
      const mainClasses = isEmpty
        ? 'flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-6'
        : 'flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pt-10 pb-6';

      if (mainRegion.className !== mainClasses) {
        mainRegion.className = mainClasses;
      }

      mainRegion.innerHTML = renderChatSection(locale, state);
      // Keep the newest part of the conversation in view
      if (mc && mc.phase !== 'error' && mc.phase !== 'tool') {
        mainRegion.scrollTop = mainRegion.scrollHeight;
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
  }

  // --- Event Delegation Setup ---

  if (app) {
    registerAllEvents(app);
  }

  // Initialization: the last known state right away, then the server's
  initTheme();
  showCachedChat();
  render();
  void startSession();

  // Trigger fade-in effect (first visit in this session)
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
