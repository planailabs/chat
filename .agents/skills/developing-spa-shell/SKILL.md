---
name: developing-spa-shell
description: Use when working in web/src/chat/ (the chat UI) or web/src/dashboard/ (admin dashboard), adding UI state, calling the Rust API, or touching the inline boot script in web/index.html. Covers action-driven state, the shared typed API client, the chat event stream, and manual i18n/theme resolution.
---

# Developing the SPA Shell

## Overview

The UI is plain TypeScript built by Vite (`web/`), served as static files by the Rust server (`server/`) on the same origin. Two pages: the chat (`web/index.html` → `web/src/chat/main.ts`) and the admin dashboard (`web/dashboard/index.html` → `web/src/dashboard/main.ts`). There is no framework or router: actions mutate a central store, and `main.ts` re-renders regions from template strings.

## Core Patterns

### 1. Action-Driven State Management

Logic lives in `web/src/chat/actions/**/*.ts`, coordinated by the `store` in `web/src/chat/app/store.ts` (state shape in `app/state.ts`).

- **Always** put side effects (API calls, storage, timers) in action files, not in `ui/` renderers or `main.ts`.
- **Notify** the store (`store.notify()` / `store.setState()`) after state changes to re-render.
- Chat phases go through `transition()` in `actions/chat/stateMachine.ts` only.

### 2. The API (`web/src/chat/api.ts`)

One typed client, shared by chat and dashboard, for the server's `/api/v1/...` (cookie session, JSON).

- Add endpoints there with their types; never `fetch('/api/...')` elsewhere.
- Errors are `ApiError` (`status`, `code`, `message`); `isUnauthorized(e)` = signed out (HTTP 401).
- Sign-in/out are navigations: `signIn(path)` → `/auth/login?redirect=…`, `signOut()` → `/auth/logout`. There is no client-side token.
- Admin impersonation is the `impersonate_user_id` cookie (`startImpersonation` / `stopImpersonation`); the profile's `impersonating` flag makes the UI read-only.

### 3. Conversations and the Event Stream

One assistant, many conversations per user. The open one is `store.state.activeConversationId` (null: a new chat), mirrored in the URL (`/c/<id>`, `app/route.ts`; `openConversation(id, 'push' | 'replace' | 'none')` in `actions/chat/session.ts`, popstate in `main.ts`). The first message of a new chat (`api.chat.send(null, …)`) returns the conversation's id.

One `EventSource(/api/v1/chat/events)` (`actions/chat/sse.ts`) carries every conversation; each event names its `conversation`. `routeServerEvent` (`actions/chat/events.ts`) sends the open one's events to the chat, marks others in the sidebar (busy/unread, moved to the top), refetches the list for unknown ones, and holds events of a conversation being started until its id is back. Connect before sending (`await connectEvents()`); `resync` and reconnects refetch the list and the open history. Pure logic (grouping, routing, list updates) lives in `actions/chat/conversationList.ts`, `actions/chat/history.ts` and `app/route.ts`, all unit-tested.

### Sidebar and applications

`ui/sidebar.ts` renders New chat, the grouped conversations (rename, delete) and the applications from `content/applications.ts` (one entry per app). Regions in `main.ts` are only rewritten when their markup changes; use `replaceMarkup`/`isReplacingMarkup` (`utils/dom.ts`) so a re-render isn't mistaken for the user leaving an input.

### 4. Manual i18n & Theme Resolution

A blocking inline `<script>` in `web/index.html` sets `lang` and `data-theme` before the bundle loads, to prevent flashes.

- **Language**: `sessionStorage` (`planai-language`) or browser detection; strings in `web/src/chat/content/locales.ts` (`en`, `de` — add both).
- **Theme**: `sessionStorage` (`planai-theme-mode`) or `prefers-color-scheme`. Signed-in users' choices are also saved to their profile.

### 5. DOM Layout Initialization

`initApp` in `web/src/chat/main.ts` builds the shell (`header-region`, `main-region`, `footer-region`, `overlay-region`) and wires delegated events (`web/src/chat/events/`).

## Best Practices

- **Escape** every interpolated string with `escapeHtml`; assistant markdown goes through `renderMarkdown` (marked + DOMPurify), never raw into `innerHTML`.
- **CSS Variables**: Use `--surface-base`, `--text-primary`, `--text-muted` for theme-aware styling.
- **Checks**: `cd web && pnpm exec tsc --noEmit -p . && pnpm test && pnpm build`.
