---
name: developing-spa-shell
description: Use when working in src/spa/ or modifying the core application shell in index.astro. Covers action-driven state management, manual i18n/theme resolution, and DOM-based layout initialization.
---

# Developing SPA Shell

## Overview

The project uses Astro as a shell to load a custom TypeScript SPA. This architecture bypasses traditional framework routers in favor of a fast, action-driven DOM manipulation pattern.

## Core Patterns

### 1. Action-Driven State Management

Logic is decoupled into `src/spa/actions/*.ts` and coordinated by a central `store` (in `src/spa/app/store`).

- **Always** export discrete async actions for side effects (API calls, storage).
- **Notify** the store after state changes to trigger re-renders or DOM updates.

### 2. Manual i18n & Theme Resolution

Initialization happens in a blocking `<script is:inline>` in `index.astro` to prevent flashes.

- **Language**: Resolved via `sessionStorage` (key: `planai-language`) or browser detection.
- **Theme**: Resolved via `sessionStorage` (key: `planai-theme-mode`) or system preference (prefers-color-scheme).

### 3. DOM Layout Initialization

The `initApp` function in `src/spa/main.ts` builds the core shell structure:

```ts
app.innerHTML = `
  <div class="app-shell flex flex-col ...">
    <div id="header-region"></div>
    <main id="main-region"></main>
    <footer id="footer-region"></footer>
  </div>
`;
```

## Best Practices

- **CSS Variables**: Use `--surface-base` and `--text-primary` for theme-aware styling.
- **Side Effects**: keep them in action files, not in the view/main.ts.
- **Vite Integration**: Prefix public env variables with `VITE_` or `PUBLIC_`.
- **Links**: Always append a trailing slash to internal Astro links (e.g., `href="/chat/"`) to match the platform's default routing resolution.
