/**
 * Application Store
 *
 * One reactive state object (Vue `reactive`) shared by the actions and the
 * components. Actions either call `setState` or mutate `store.state`
 * directly; components re-render from whatever they read. `notify` is kept
 * for actions that mutate and then want to tell non-Vue listeners.
 */

import { reactive } from 'vue';
import { createInitialState, type AppState } from './state';

type StoreListener = () => void;

class Store {
  /** The application state (reactive; never replaced, only updated). */
  readonly state: AppState = reactive(createInitialState()) as AppState;

  private listeners = new Set<StoreListener>();

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Tells subscribers about a direct mutation (Vue tracks it by itself). */
  notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  /** Merges a partial state (or an updater's result) into the state. */
  setState(updater: Partial<AppState> | ((state: AppState) => Partial<AppState>)): void {
    const updates = typeof updater === 'function' ? updater(this.state) : updater;
    Object.assign(this.state, updates);
    this.notify();
  }
}

/** Singleton store instance */
export const store = new Store();
