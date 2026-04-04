/**
 * Chat Actions — barrel re-exports and top-level actions (switchChatMode, nukeChat).
 */

import { store } from '../../app/store';
import { type ClientChatModeId } from '../../constants';
import { withImpersonate } from '../../impersonation';
import { clearAIChatMessages, getJwt } from './cache';
import { disconnectEvents } from './sse';
import { restoreAIChatSession } from './session';

// ─── Re-exports ─────────────────────────────────────────────────────────────

export {
  clearChatTimers,
  startNewsletterPrompt,
  startPostLoginSequence,
  setShouldRunPostLoginSequence,
  tryStartPostLoginSequence,
  startNewsletterReconsiderFlow,
  handleChatNewsletterChoice,
} from './newsletter';

export {
  clearAIChatMessages,
  clearMachineConfigMessages,
  consumePendingSalesPrompt,
} from './cache';

export { disconnectEvents } from './sse';

export {
  restoreAIChatSession,
  restoreMachineConfigSession,
} from './session';

export { answerPreferencePrompt } from './preference';

export {
  sendChatMessage,
  sendMachineConfigMessage,
  answerChatQuestion,
  answerMachineConfigQuestion,
  cancelChatQuestion,
  cancelMachineConfigQuestion,
  sendPendingSalesPrompt,
} from './stateMachine';

export {
  handlePromptSubmit,
  startChatFromPrompt,
  restoreChatSession,
} from './prompt';

// ─── Top-level Actions ──────────────────────────────────────────────────────

/**
 * Switches the active chat mode. Disconnects current SSE, saves state,
 * switches mode, and restores/inits the new mode.
 */
export const switchChatMode = (newMode: ClientChatModeId): void => {
  const state = store.state;
  if (state.activeChatMode === newMode) return;

  // Machine config requires customer token
  if (newMode === 'machine_config' && !state.customerToken) return;

  // Disconnect current EventSource
  disconnectEvents();

  // Clear current chat state
  state.chat = null;
  state.heroPhase = 'composer';
  state.activeChatMode = newMode;
  store.notify();

  // Restore/init the new mode
  restoreAIChatSession();
};

/**
 * Dev-only: deletes all chat messages for the current user & mode via /api/chat/nuke/,
 * clears the local cache, and reloads the page.
 */
export const nukeChat = async (): Promise<void> => {
  const jwt = await getJwt();
  if (!jwt) return;

  const mode = store.state.activeChatMode;
  try {
    await fetch(withImpersonate(`/api/chat/nuke/?mode=${encodeURIComponent(mode)}`), {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
    });
  } catch {
    // ignore network errors
  }

  clearAIChatMessages(mode);
  window.location.reload();
};
