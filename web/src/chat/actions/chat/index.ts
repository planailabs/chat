/**
 * Chat Actions — barrel re-exports and top-level actions (new chat, delete,
 * the sidebar).
 */

import { store } from '../../app/store';
import { persistSidebarCollapsed } from '../../app/state';
import { api } from '../../api';
import { forgetConversation } from './conversations';
import { openConversation } from './session';
import { showChatError } from './stateMachine';

export { clearAllCachedChatMessages, clearPendingPrompt, consumePendingPrompt, readPendingPrompt } from './cache';
export { connectEvents, disconnectEvents } from './sse';
export { loadConversations, renameConversation, startRenaming, stopRenaming } from './conversations';
export { openConversation, sendPendingPrompt, showAnonymousChat, showCachedChat } from './session';
export { answerPreferencePrompt } from './preference';
export { sendChatMessage, answerChatQuestion, cancelChatQuestion, decideApproval, type ApprovalAction } from './stateMachine';

/** An empty chat; its first message starts a conversation. */
export const startNewChat = () => {
  if (store.state.activeConversationId === null && (store.state.chat?.messages.length ?? 0) === 0) {
    store.setState({ isSidebarOpen: false });
    return;
  }
  void openConversation(null, 'push');
};

/** Deletes a conversation (the caller has confirmed). */
export const deleteConversation = async (id: string) => {
  try {
    await api.chat.remove(id);
  } catch (error) {
    showChatError(error);
    return;
  }
  forgetConversation(id);
  if (store.state.activeConversationId === id) await openConversation(null, 'replace');
};

/** Desktop: collapses or expands the sidebar. Mobile: opens or closes the drawer. */
export const toggleSidebar = (desktop: boolean) => {
  const state = store.state;
  if (desktop) {
    persistSidebarCollapsed(!state.isSidebarCollapsed);
    store.setState({ isSidebarCollapsed: !state.isSidebarCollapsed });
  } else {
    store.setState({ isSidebarOpen: !state.isSidebarOpen });
  }
};

export const closeSidebarDrawer = () => {
  if (store.state.isSidebarOpen) store.setState({ isSidebarOpen: false });
};
