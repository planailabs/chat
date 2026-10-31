import { store } from '../app/store';
import { locales } from '../content/index';
import { delegateEvent } from '../utils/dom';
import { handleSignOut } from '../actions/auth';
import { closeSettingsOverlay } from '../actions/overlay';
import {
  requestAccountDeletion,
  handleDataExport,
  handleSettingsNewsletterToggle,
} from '../actions/settings';

export const registerSettingsEvents = (app: HTMLElement) => {
  // Settings: Close
  delegateEvent(app, 'click', '[data-action="close-settings"]', (event) => {
    event.preventDefault();
    closeSettingsOverlay();
  });

  // Settings: Sign Out
  delegateEvent(app, 'click', '[data-action="overlay-sign-out"]', (event) => {
    event.preventDefault();
    closeSettingsOverlay();
    handleSignOut();
  });

  // Settings: Delete Account
  delegateEvent(app, 'click', '[data-action="delete-account"]', (event) => {
    event.preventDefault();
    const state = store.state;
    const locale = locales[state.localeKey];
    requestAccountDeletion(locale);
  });

  // Settings: Request Data
  delegateEvent(app, 'click', '[data-action="request-data"]', (event) => {
    event.preventDefault();
    const state = store.state;
    const locale = locales[state.localeKey];
    handleDataExport(locale);
  });

  // Settings: Newsletter Toggle
  delegateEvent(
    app,
    'change',
    '[data-setting="newsletter-opt-in"]',
    (event, target) => {
      const input = target as HTMLInputElement;
      handleSettingsNewsletterToggle(input.checked);
    },
  );
};
