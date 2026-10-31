import './style.css';
import { locales } from './content/index';
import { renderHeader } from './ui/header';
import { renderSettingsOverlay } from './ui/settingsOverlay';
import { renderChatSection } from './ui/chat';
import { DESKTOP_QUERY, renderSidebar, sidebarRegionClass } from './ui/sidebar';
import { store } from './app/store';
import { conversationIdFromPath } from './app/route';

// Actions
import { startSession } from './actions/auth';
import { openConversation, showCachedChat } from './actions/chat';
import { initTheme } from './actions/theme';

import { registerAllEvents } from './events';
import { replaceMarkup } from './utils/dom';

const initApp = () => {
  const app = document.querySelector<HTMLDivElement>('#app');

  // Initialization of layout structure
  if (app) {
    app.innerHTML = `
    <div class="app-shell flex bg-(--surface-base) text-(--text-primary)">
      <aside id="sidebar-region" class="sidebar is-hidden"></aside>

      <div class="flex min-w-0 flex-1 flex-col">
        <div id="header-region" class="shrink-0"></div>

        <main id="main-region" class="flex min-h-0 flex-1 flex-col items-center px-6"></main>

        <footer id="footer-region" class="shrink-0 px-4 py-3 text-center text-xs text-(--text-muted) md:px-6 md:py-4"></footer>
      </div>
    </div>
    <div id="overlay-region"></div>
  `;
  }

  const sidebarRegion = app?.querySelector('#sidebar-region') as HTMLElement;
  const headerRegion = app?.querySelector('#header-region') as HTMLElement;
  const mainRegion = app?.querySelector('#main-region') as HTMLElement;
  const footerRegion = app?.querySelector('#footer-region') as HTMLElement;
  const overlayRegion = app?.querySelector('#overlay-region') as HTMLElement;

  // Subscriptions
  store.subscribe(render);

  // Regions are only rewritten when their markup changes: a notify for one
  // part (e.g. another conversation's activity) leaves typed input and
  // scroll positions in the others alone.
  let lastSidebar: string | null = null;
  let lastMain: string | null = null;

  const renderSidebarRegion = (markup: string) => {
    if (markup === lastSidebar) return;
    lastSidebar = markup;
    // An open rename keeps what was typed so far.
    const input = sidebarRegion.querySelector<HTMLInputElement>('[data-action="rename-input"]');
    const editing = input ? { id: input.dataset.id, value: input.value, start: input.selectionStart, end: input.selectionEnd, focused: document.activeElement === input } : null;
    replaceMarkup(sidebarRegion, markup);
    const next = sidebarRegion.querySelector<HTMLInputElement>('[data-action="rename-input"]');
    if (!next) return;
    if (editing && editing.id === next.dataset.id) {
      next.value = editing.value;
      if (editing.focused) {
        next.focus();
        next.setSelectionRange(editing.start, editing.end);
      }
    } else {
      next.focus();
      next.select();
    }
  };

  function render() {
    if (!app) {
      return;
    }
    const state = store.state;
    const locale = locales[state.localeKey];

    // 0. Sidebar
    if (sidebarRegion) {
      const regionClass = sidebarRegionClass(state);
      if (sidebarRegion.className !== regionClass) sidebarRegion.className = regionClass;
      renderSidebarRegion(renderSidebar(state, locale));
    }

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

      const mainMarkup = renderChatSection(locale, state);
      if (mainMarkup !== lastMain) {
        lastMain = mainMarkup;
        mainRegion.innerHTML = mainMarkup;
        // Keep the newest part of the conversation in view
        if (mc && mc.phase !== 'error' && mc.phase !== 'tool') {
          mainRegion.scrollTop = mainRegion.scrollHeight;
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
  }

  // --- Event Delegation Setup ---

  if (app) {
    registerAllEvents(app);
  }

  // Back/forward between conversations.
  window.addEventListener('popstate', () => {
    if (!store.state.isAuthenticated) return;
    const id = conversationIdFromPath(window.location.pathname);
    if (id !== store.state.activeConversationId) void openConversation(id, 'none');
  });

  // Crossing the desktop width switches between drawer and column.
  window.matchMedia?.(DESKTOP_QUERY).addEventListener?.('change', () => {
    store.setState({ isSidebarOpen: false });
  });

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
