import type { AppState } from '../app/state';
import type {
  ConversationScenario,
  ConversationStep,
  LocaleContent,
  ScenarioId,
} from '../content';

export type PromptConversationPlan =
  | {
      type: 'anonymous';
      scenarioId: ScenarioId;
      stepId: string;
    }
  | {
      type: 'signedInSubscribed';
      responseText: string;
    }
  | {
      type: 'signedInUnsubscribed';
      responseText: string;
      followup: 'newsletter-reconsider';
    }
  | {
      type: 'aiChat';
    };

export type PostLoginQuestionPlan = 'default' | 'alreadySubscribed';

export const planPromptConversation = (
  state: AppState,
  locale: LocaleContent,
): PromptConversationPlan => {
  if (!state.isAuthenticated) {
    const scenario = locale.conversationScenarios.anonymousInvite;
    return {
      type: 'anonymous',
      scenarioId: scenario.id,
      stepId: scenario.entryStepId,
    };
  }

  // AI chat mode: machine config (needs token), or sales/newsletter (always available)
  if (state.activeChatMode === 'machine_config' && state.customerToken) {
    return { type: 'aiChat' };
  }
  if (state.activeChatMode === 'sales') {
    return { type: 'aiChat' };
  }

  const newsletterStatus = state.profile.newsletterStatus;
  if (newsletterStatus === 'subscribed') {
    return {
      type: 'signedInSubscribed',
      responseText: locale.chat.afterPrompt.subscribedThanks,
    };
  }

  return {
    type: 'signedInUnsubscribed',
    responseText: locale.chat.afterPrompt.unsubscribedThanks,
    followup: 'newsletter-reconsider',
  };
};

export const planPostLoginQuestion = (
  state: AppState,
): PostLoginQuestionPlan => {
  return state.profile.newsletterStatus === 'subscribed'
    ? 'alreadySubscribed'
    : 'default';
};

export interface ConversationPointer {
  scenarioId: ScenarioId;
  stepId: string;
}

export interface ConversationStepResolution {
  pointer: ConversationPointer;
  step: ConversationStep;
  scenario: ConversationScenario;
}

export const getScenarioEntryStep = (
  locale: LocaleContent,
  scenarioId: ScenarioId,
  stepId?: string,
): ConversationStepResolution | null => {
  const scenario = locale.conversationScenarios[scenarioId];
  if (!scenario) {
    return null;
  }
  const resolvedStepId = stepId ?? scenario.entryStepId;
  const step = scenario.steps[resolvedStepId];
  if (!step) {
    return null;
  }
  return {
    pointer: { scenarioId, stepId: resolvedStepId },
    step,
    scenario,
  };
};

export const getScenarioStep = (
  locale: LocaleContent,
  pointer: ConversationPointer,
): ConversationStep | null => {
  const scenario = locale.conversationScenarios[pointer.scenarioId];
  if (!scenario) {
    return null;
  }
  return scenario.steps[pointer.stepId] ?? null;
};

export type CtaChoice = 'positive' | 'negative';

export const getNextPointerFromCta = (
  pointer: ConversationPointer,
  step: ConversationStep,
  choice?: CtaChoice,
): ConversationPointer | null => {
  if (!step.cta) {
    return step.nextStepId
      ? { scenarioId: pointer.scenarioId, stepId: step.nextStepId }
      : null;
  }
  if (step.cta.type === 'newsletter_prompt') {
    if (choice === 'positive') {
      return {
        scenarioId: pointer.scenarioId,
        stepId: step.cta.positiveStepId,
      };
    }
    if (choice === 'negative') {
      return {
        scenarioId: pointer.scenarioId,
        stepId: step.cta.negativeStepId,
      };
    }
    return null;
  }
  if (step.cta.type === 'oauth_providers') {
    return step.nextStepId
      ? { scenarioId: pointer.scenarioId, stepId: step.nextStepId }
      : null;
  }
  return null;
};
