import { store } from '../app/store';

export const registerGlobalEvents = () => {
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
};
