---
name: developing-spa-shell
description: Use when working in web/src/chat/ (the chat UI) or web/src/dashboard/ (admin dashboard), adding Vue components or UI state, calling the Rust API, or touching the inline boot script in web/index.html. Covers the Vue 3 + Parcel setup, action-driven reactive state, the shared typed API client, the chat event stream, and manual i18n/theme resolution.
---

# Developing the SPA Shell

## Overview

The UI is Vue 3 (Composition API, `<script setup lang="ts">` single-file components) with Vue Router, built by Parcel 2 (`web/`, entries in `package.json` `source`), served as static files by the Rust server (`server/`) on the same origin. Two pages, two Vue apps: the chat (`web/index.html` → `web/src/chat/main.ts` → `App.vue`, routes in `router.ts`) and the admin dashboard (`web/dashboard/index.html` → `web/src/dashboard/main.ts` → `Dashboard.vue`, one route per tab under `/dashboard/`, kept alive between tabs). The build writes `dist/index.html` and `dist/dashboard/index.html` with the hashed assets at the root of `dist/`.

- `pnpm dev`: Parcel's dev server on :1234; `web/.proxyrc.cjs` proxies `/api` and `/auth` to 127.0.0.1:8080 and serves the dashboard page for `/dashboard/*`.
- `pnpm build` (Nix and CI), `pnpm watch` (the Procfile; no HMR, the Rust server serves `dist`).
- Parcel's Vue transformer does **not** compile TypeScript inside template expressions: keep casts and typed lambdas in `<script setup>`.
- Props with imported types use runtime declarations (`{ type: Object as PropType<T>, required: true }`); inline literal types in `defineProps<…>()` are fine.
- vue-router's (and other) package `exports` need `"@parcel/resolver-default": { "packageExports": true }` in `package.json` (set).

## Core Patterns

### 1. Action-Driven State Management

Logic lives in `web/src/chat/actions/**/*.ts`, coordinated by the `store` in `web/src/chat/app/store.ts` (state shape in `app/state.ts`). `store.state` is one Vue `reactive` object (never replaced): actions mutate it or call `store.setState()`, and components read it directly (`const state = store.state`), so there is no Pinia. `app/locale.ts` (`locale`), `app/viewport.ts` (`isDesktop`) and `systemTheme` (`actions/theme.ts`) are shared refs.

- **Always** put side effects (API calls, storage, timers) in action files, not in components or `main.ts`; components call actions from their event handlers.
- Chat phases go through `transition()` in `actions/chat/stateMachine.ts` only.

### 2. The API (`web/src/chat/api.ts`)

One typed client, shared by chat and dashboard, for the server's `/api/v1/...` (cookie session, JSON).

- Add endpoints there with their types; never `fetch('/api/...')` elsewhere.
- Errors are `ApiError` (`status`, `code`, `message`); `isUnauthorized(e)` = signed out (HTTP 401).
- Sign-in/out are navigations: `signIn(path)` → `/auth/login?redirect=…`, `signOut()` → `/auth/logout`. There is no client-side token.
- Admin impersonation is the `impersonate_user_id` cookie (`startImpersonation` / `stopImpersonation`); the profile's `impersonating` flag makes the UI read-only.

### 3. Conversations and the Event Stream

One assistant, many conversations per user. The open one is `store.state.activeConversationId` (null: a new chat), mirrored in the URL (`/c/<id>`, `app/route.ts`; `openConversation(id, 'push' | 'replace' | 'none')` in `actions/chat/session.ts`). The actions move the URL through Vue Router (`useNavigator` in `main.ts`); `router.afterEach` opens the conversation on back/forward. The first message of a new chat (`api.chat.send(null, …)`) returns the conversation's id.

One `EventSource(/api/v1/chat/events)` (`actions/chat/sse.ts`) carries every conversation; each event names its `conversation`. `routeServerEvent` (`actions/chat/events.ts`) sends the open one's events to the chat, marks others in the sidebar (busy/unread, moved to the top), refetches the list for unknown ones, and holds events of a conversation being started until its id is back. Connect before sending (`await connectEvents()`); `resync` and reconnects refetch the list and the open history. Pure logic (grouping, routing, list updates) lives in `actions/chat/conversationList.ts`, `actions/chat/history.ts` and `app/route.ts`, all unit-tested.

### Sidebar and applications

`components/AppSidebar.vue` renders New chat, the grouped conversations (rename, delete) and the applications from `content/applications.ts` (one entry per app; icons by name from `ui/icons.ts` through `AppIcon.vue`). The search field above the list (Ctrl/Cmd+K focuses it, Escape clears it) shows `SearchResults.vue` instead of the list: `POST /api/v1/chat/search` debounced, hits grouped by conversation (`actions/chat/search.ts`, unit-tested). Snippets mark matches between U+E000 and U+E001: `snippetHtml`/`titleHtml` escape the text first and only then turn those two characters into `<mark>`; never put a snippet into `v-html` otherwise. Opening a message hit sets `highlightMessageId`; `ChatView` scrolls to the message (`data-message-id`, from the history's message ids) and highlights it briefly. Inputs (the composer, a rename) keep what is typed while other parts re-render: the composer's contenteditable is never bound to state, only read on send.

### 4. Manual i18n & Theme Resolution

A blocking inline `<script>` in `web/index.html` sets `lang` and `data-theme` before the bundle loads, to prevent flashes.

- **Language**: `sessionStorage` (`planai-language`) or browser detection; strings in `web/src/chat/content/locales.ts` (`en`, `de` — add both).
- **Theme**: `sessionStorage` (`planai-theme-mode`) or `prefers-color-scheme`. Signed-in users' choices are also saved to their profile.

### 5. Components

`App.vue` lays out `AppSidebar`, `AppHeader`, the routed `ChatView` (the scrolling `<main>`) and `SettingsOverlay`. `ChatView` composes `components/chat/`: `ChatMessages`, `QuestionPrompt` (ask_question), `PreferencePrompt` (prompt_preference), `ApprovalCard`, `LoginInvite`, `ChatComposer`.

## Best Practices

- **Text** goes through `{{ }}` (escaped). `v-html` only for `renderMarkdown` output (marked + DOMPurify), trusted locale strings and icon constants, never for user or model text directly.
- **CSS Variables**: Use `--surface-base`, `--text-primary`, `--text-muted` for theme-aware styling.
- **Checks**: `cd web && pnpm typecheck && pnpm test && pnpm build`. Component tests use `@vue/test-utils` (`src/chat/components/components.test.ts`).
