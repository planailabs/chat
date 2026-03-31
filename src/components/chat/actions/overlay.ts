import { store } from '../app/store';

let settingsOverlayHistoryActive = false;

export const openSettingsOverlay = () => {
  const state = store.state;
  if (state.isSettingsOverlayOpen) {
    return;
  }
  store.setState({ isSettingsOverlayOpen: true });
  if (typeof window !== 'undefined' && window.history) {
    window.history.pushState({ overlay: 'settings' }, '');
    settingsOverlayHistoryActive = true;
  }
};

export const closeSettingsOverlay = (options?: { fromHistory?: boolean }) => {
  const state = store.state;
  if (!state.isSettingsOverlayOpen) {
    return;
  }
  store.setState({
    dataExportStatus: 'idle',
    isSettingsOverlayOpen: false,
  });

  if (!options?.fromHistory && settingsOverlayHistoryActive) {
    settingsOverlayHistoryActive = false;
    if (typeof window !== 'undefined' && window.history) {
      window.history.back();
    }
  }
  if (options?.fromHistory) {
    settingsOverlayHistoryActive = false;
  }
};

export const handleGlobalPopState = () => {
  if (store.state.isSettingsOverlayOpen) {
    closeSettingsOverlay({ fromHistory: true });
  }
};

export const handleGlobalKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && store.state.isSettingsOverlayOpen) {
    event.preventDefault();
    closeSettingsOverlay();
  }
};

// Initialize global listeners
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', handleGlobalPopState);
  window.addEventListener('keydown', handleGlobalKeyDown);
}
