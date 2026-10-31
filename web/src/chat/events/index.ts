import { registerHeaderEvents } from './headerEvents';
import { registerChatEvents } from './chatEvents';
import { registerSettingsEvents } from './settingsEvents';
import { registerGlobalEvents } from './globalEvents';
import { registerSidebarEvents } from './sidebarEvents';

export const registerAllEvents = (app: HTMLElement) => {
  registerHeaderEvents(app);
  registerChatEvents(app);
  registerSidebarEvents(app);
  registerSettingsEvents(app);
  registerGlobalEvents();
};
