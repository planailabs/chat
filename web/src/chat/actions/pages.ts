/**
 * The side panel's page: open (the latest version, or reload it when a new
 * one arrives), close, full screen.
 */

import { store } from '../app/store';

export const openPage = (id: string, version: number | null = null) => {
  const open = store.state.openPage;
  store.setState({ openWorker: null, openPage: { id, version, rev: (open?.rev ?? 0) + 1, fullscreen: open?.id === id ? open.fullscreen : false } });
};

export const closePage = () => store.setState({ openPage: null });

/** A worker's transcript in the side panel (instead of a page). */
export const openWorker = (id: string) => store.setState({ openPage: null, openWorker: id });

export const closeWorker = () => store.setState({ openWorker: null });

export const setPageFullscreen = (fullscreen: boolean) => {
  const open = store.state.openPage;
  if (open) store.setState({ openPage: { ...open, fullscreen } });
};
