---
name: testing-with-vitest
description: Use when writing, running, or fixing unit tests. The project uses Vitest.
---

# Testing with Vitest

## Overview

This project uses [Vitest](https://vitest.dev/) for fast unit tests of the UI in `web/` (run from `web/`), in Node by default. It covers the API client, history mapping and rendering helpers without a full browser. The Rust server has its own tests (`cargo test` in `server/`).

## Commands

Prefer `pnpm` for all test commands.

- `pnpm vitest` (Watch mode, recommended during dev)
- `pnpm vitest run` (Run full suite once, CI-friendly)
- `pnpm vitest run src/path/to/file.test.ts` (Run specific test)

## Testing Constraints & Patterns

### 1. File Placement

Place `.test.ts` files adjacent to the module they cover (e.g., `web/src/chat/api.test.ts`).

### 2. Mocking Browser Globals (Node Environment)

Because Vitest runs in Node, browser globals (`window`, `sessionStorage`, `crypto`) do not exist. You **must** mock them before each test if the target module relies on them.

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

Code that needs a real DOM (e.g. DOMPurify in `utils/markdown.ts`) opts into jsdom with a `// @vitest-environment jsdom` comment at the top of the test file.

### 3. Time Manipulation

Use `vi.useFakeTimers()` when testing timeouts, intervals, or streaming mechanics.

## Continuous Updates (Self-Healing Requirement)

If the testing framework changes (e.g., Playwright is added for E2E), use `mcporter call context7.query-docs` to research the latest testing patterns and update this skill.
