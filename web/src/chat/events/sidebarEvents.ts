import { store } from '../app/store';
import { locales } from '../content';
import { delegateEvent, isReplacingMarkup } from '../utils/dom';
import { isDesktopViewport } from '../ui/sidebar';
import {
  closeSidebarDrawer,
  deleteConversation,
  openConversation,
  renameConversation,
  startNewChat,
  startRenaming,
  stopRenaming,
  toggleSidebar,
} from '../actions/chat';

export const registerSidebarEvents = (app: HTMLElement) => {
  delegateEvent(app, 'click', '[data-action="sidebar-toggle"]', (event) => {
    event.stopPropagation();
    toggleSidebar(isDesktopViewport());
  });

  delegateEvent(app, 'click', '[data-action="sidebar-close"]', () => {
    closeSidebarDrawer();
  });

  delegateEvent(app, 'click', '[data-action="new-chat"]', () => {
    startNewChat();
  });

  // A link, so it can also open in a new tab (modifier keys, middle click).
  delegateEvent<MouseEvent>(app, 'click', '[data-action="open-conversation"]', (event, target) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const id = target.dataset.id;
    if (!id) return;
    if (id === store.state.activeConversationId) {
      closeSidebarDrawer();
      return;
    }
    void openConversation(id, 'push');
  });

  delegateEvent(app, 'click', '[data-action="rename-conversation"]', (event, target) => {
    event.preventDefault();
    if (target.dataset.id) startRenaming(target.dataset.id);
  });

  delegateEvent<KeyboardEvent>(app, 'keydown', '[data-action="rename-input"]', (event, target) => {
    const input = target as HTMLInputElement;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (input.dataset.id) void renameConversation(input.dataset.id, input.value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      stopRenaming();
    }
  });

  // Leaving the field saves (not when a re-render removed it).
  delegateEvent(app, 'focusout', '[data-action="rename-input"]', (_event, target) => {
    if (isReplacingMarkup()) return;
    const input = target as HTMLInputElement;
    if (input.dataset.id && store.state.renamingConversationId === input.dataset.id) {
      void renameConversation(input.dataset.id, input.value);
    }
  });

  delegateEvent(app, 'click', '[data-action="delete-conversation"]', (event, target) => {
    event.preventDefault();
    const id = target.dataset.id;
    const conversation = store.state.conversations.find((c) => c.id === id);
    if (!id || !conversation) return;
    const question = locales[store.state.localeKey].sidebar.deleteConfirm.replace('{{title}}', conversation.title);
    if (window.confirm(question)) void deleteConversation(id);
  });

  // Escape closes the mobile drawer.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && store.state.isSidebarOpen) closeSidebarDrawer();
  });
};
