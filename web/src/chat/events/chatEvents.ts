import { store } from '../app/store';
import { delegateEvent } from '../utils/dom';
import { handleSignIn } from '../actions/auth';
import {
  sendChatMessage,
  answerChatQuestion,
  cancelChatQuestion,
  answerPreferencePrompt,
  decideApproval,
  type ApprovalAction,
} from '../actions/chat';

export const registerChatEvents = (app: HTMLElement) => {
  // Chat: Login Invite (anonymous prompt → sign-in)
  delegateEvent(app, 'click', '[data-action="login-invite-sign-in"]', (event) => {
    event.stopPropagation();
    const invite = store.state.chat?.loginInvite;
    if (!invite || invite.ctaLocked) return;
    invite.ctaLocked = true;
    store.notify();
    handleSignIn();
  });

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

  // Chat: Machine Config Enter Key (Shift+Enter inserts newline)
  delegateEvent(
    app,
    'keydown',
    '[data-action="machine-config-input"]',
    (event) => {
      const keyEvent = event as KeyboardEvent;
      if (keyEvent.key !== 'Enter') return;
      if (keyEvent.shiftKey) return; // allow default newline insertion
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

  // Chat: Approval decision (approve / deny / approve all)
  delegateEvent(app, 'click', '[data-action="approval-decision"]', (event, target) => {
    event.stopPropagation();
    const callId = target.getAttribute('data-call-id');
    const decision = target.getAttribute('data-decision');
    if (callId && (decision === 'approve' || decision === 'deny' || decision === 'approve_all')) {
      void decideApproval(callId, decision as ApprovalAction);
    }
  });
};
