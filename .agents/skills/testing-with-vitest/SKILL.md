---
name: testing-with-vitest
description: Use when writing, running, or fixing unit tests. The project uses Vitest.
---

# Testing with Vitest

## Overview

This project uses [Vitest](https://vitest.dev/) for fast unit tests of the UI in `web/` (run from `web/`), in Node by default. It covers the API client, history mapping, routing, event routing and the Vue components (with `@vue/test-utils`; `vitest.config.ts` uses `@vitejs/plugin-vue` only to compile `.vue` files for tests, the app itself is built by Parcel). The default environment is jsdom. The Rust server has its own tests (`cargo test` in `server/`).

## Commands

Prefer `pnpm` for all test commands.

- `pnpm vitest` (Watch mode, recommended during dev)
- `pnpm vitest run` (Run full suite once, CI-friendly)
- `pnpm vitest run src/path/to/file.test.ts` (Run specific test)

## Testing Constraints & Patterns

### 1. File Placement

Place `.test.ts` files adjacent to the module they cover (e.g., `web/src/chat/api.test.ts`).

### 2. Mocking Browser Globals (Node Environment)

Tests run in jsdom, but network and navigation do not exist: stub `fetch` (and `window` pieces such as `history` when a test needs exact calls) with `vi.stubGlobal`.

**Example Pattern:**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  // Provide a mock sessionStorage
  vi.stubGlobal('window', { sessionStorage: createMockStorage() } as Window &
    typeof globalThis);
});
```

Mock the API with `vi.stubGlobal('fetch', fetchMock)` and return a fresh `Response` per call (`mockImplementation`), since a body can be read once.

Component tests mount with `mount()` from `@vue/test-utils`, set `store.state` directly, and mock `../actions/chat` with `vi.mock` to assert which action a click calls (see `src/chat/components/components.test.ts`).

### 3. Time Manipulation

Use `vi.useFakeTimers()` when testing timeouts, intervals, or streaming mechanics.

## Continuous Updates (Self-Healing Requirement)

If the testing framework changes (e.g., Playwright is added for E2E), use `mcporter call context7.query-docs` to research the latest testing patterns and update this skill.
