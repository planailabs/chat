import { describe, expect, it } from 'vitest';
import { createInitialState } from '../app/state';
import { locales } from '../content';
import {
  getScenarioEntryStep,
  getNextPointerFromCta,
  planPromptConversation,
  planPostLoginQuestion,
} from './conversationPlanner';

const locale = locales.en;

describe('planPromptConversation', () => {
  it('returns anonymous plan for signed-out users', () => {
    const state = createInitialState();
    state.isAuthenticated = false;
    const plan = planPromptConversation(state, locale);
    expect(plan).toEqual({
      type: 'anonymous',
      scenarioId: locale.conversationScenarios.anonymousInvite.id,
      stepId: locale.conversationScenarios.anonymousInvite.entryStepId,
    });
  });

  it('returns subscribed plan when newsletter status is subscribed', () => {
    const state = createInitialState();
    state.isAuthenticated = true;
    state.newsletterPreference.status = 'subscribed';
    const plan = planPromptConversation(state, locale);
    expect(plan.type).toBe('signedInSubscribed');
    expect(plan).toHaveProperty(
      'responseText',
      locale.chat.afterPrompt.subscribedThanks,
    );
  });

  it('returns unsubscribed plan when newsletter status is not subscribed', () => {
    const state = createInitialState();
    state.isAuthenticated = true;
    state.newsletterPreference.status = 'unsubscribed';
    const plan = planPromptConversation(state, locale);
    expect(plan.type).toBe('signedInUnsubscribed');
    expect(plan).toHaveProperty('followup', 'newsletter-reconsider');
  });
});

describe('planPostLoginQuestion', () => {
  it('prefers already-subscribed variant when user subscribed', () => {
    const state = createInitialState();
    state.newsletterPreference.status = 'subscribed';
    expect(planPostLoginQuestion(state)).toBe('alreadySubscribed');
  });

  it('defaults to standard question otherwise', () => {
    const state = createInitialState();
    state.newsletterPreference.status = 'unsubscribed';
    expect(planPostLoginQuestion(state)).toBe('default');
  });
});

describe('getScenarioEntryStep', () => {
  it('returns pointer and step for valid scenario', () => {
    const scenario = locale.conversationScenarios.anonymousInvite;
    const result = getScenarioEntryStep(locale, scenario.id);
    expect(result?.pointer.scenarioId).toBe(scenario.id);
    expect(result?.pointer.stepId).toBe(scenario.entryStepId);
    expect(result?.step.text).toBe(scenario.steps[scenario.entryStepId].text);
  });

  it('returns specific step when stepId is provided', () => {
    const result = getScenarioEntryStep(
      locale,
      'postLoginNewsletter',
      'newsletter-reconsider',
    );
    expect(result?.pointer.stepId).toBe('newsletter-reconsider');
    expect(result?.step).toEqual(
      locale.conversationScenarios.postLoginNewsletter.steps[
        'newsletter-reconsider'
      ],
    );
  });

  it('returns null for unknown scenario', () => {
    const result = getScenarioEntryStep(locale, 'missing' as never);
    expect(result).toBeNull();
  });
});

describe('getNextPointerFromCta', () => {
  it('returns positive pointer for newsletter CTA', () => {
    const pointer = {
      scenarioId: 'postLoginNewsletter' as const,
      stepId: 'newsletter-question',
    };
    const step =
      locale.conversationScenarios.postLoginNewsletter.steps[pointer.stepId];
    const next = getNextPointerFromCta(pointer, step, 'positive');
    expect(next).toEqual({
      scenarioId: pointer.scenarioId,
      stepId: 'newsletter-confirm',
    });
  });

  it('falls back to nextStepId when CTA missing', () => {
    const pointer = {
      scenarioId: 'anonymousInvite' as const,
      stepId: 'invite-intro',
    };
    const step =
      locale.conversationScenarios.anonymousInvite.steps[pointer.stepId];
    const next = getNextPointerFromCta(pointer, step);
    expect(next).toBeNull();
  });
});
