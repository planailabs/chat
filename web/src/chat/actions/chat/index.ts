/**
 * Chat Actions — barrel re-exports and top-level actions (switchChatMode,
 * startNewConversation).
 */

import { store } from '../../app/store';
import { api, type ChatModeId } from '../../api';
import { clearCachedChatMessages } from './cache';
import { disconnectEvents } from './sse';
import { openChat } from './session';
import { clearChatTimers, showChatError } from './stateMachine';

export { clearAllCachedChatMessages, clearPendingSalesPrompt, consumePendingSalesPrompt } from './cache';
export { disconnectEvents } from './sse';
export { openChat, sendPendingSalesPrompt, showAnonymousChat, showCachedChat } from './session';
export { answerPreferencePrompt } from './preference';
export { sendChatMessage, answerChatQuestion, cancelChatQuestion, decideApproval, type ApprovalAction } from './stateMachine';

/** Switches to another of the user's chat modes. */
export const switchChatMode = (newMode: ChatModeId): void => {
  const state = store.state;
  if (state.activeChatMode === newMode || !state.availableModes.includes(newMode)) return;

  disconnectEvents();
  clearChatTimers();
  state.activeChatMode = newMode;
  void openChat();
};

/** Ends the conversation in the active mode; the next message starts a new one. */
export const startNewConversation = async (): Promise<void> => {
  const state = store.state;
  if (!state.isAuthenticated || state.impersonating) return;
  const mode = state.activeChatMode;
  try {
    await api.chat.reset(mode);
  } catch (error) {
    showChatError(error);
    return;
  }
  clearCachedChatMessages(mode);
  disconnectEvents();
  clearChatTimers();
  if (store.state.activeChatMode === mode) {
    await openChat();
  }
};
