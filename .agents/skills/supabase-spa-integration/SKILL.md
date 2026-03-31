---
name: supabase-spa-integration
description: Guide for integrating Supabase into the plan.ai-website SPA shell. Use when modifying authentication, user profiles, chat persistence, or newsletter subscriptions.
---

# Supabase SPA Integration

## Overview

`plan.ai-website` uses Supabase for authentication, profile management, messaging, and newsletter subscriptions. All Supabase interactions are deeply integrated into the custom SPA action layer (`src/spa/actions/`) and its corresponding state store, rather than relying on Astro's server-side capabilities.

## Architecture

### 1. Client Setup (`src/spa/supabase/client.ts`)

The Supabase client is initialized here. It gracefully handles missing environment variables for local development without failing the entire app.

### 2. Action Layer (`src/spa/actions/*.ts`)

All Supabase mutations and fetches happen through discrete actions.
**Example Pattern:**

```ts
// 1. Action calls a generic wrapper or Supabase directly
export const handlePromptSubmit = async (prompt: string) => {
  store.setState({ isGenerating: true });
  try {
    const result = await saveMessageToSupabase(prompt);
    // 2. Action updates the store
    store.setState((prev) => ({ messages: [...prev, result] }));
  } catch (e) {
    /*...*/
  }
};
```

### 3. Feature Modules (`src/spa/supabase/*.ts`)

Specific logic is grouped by feature:

- `profile.ts`: User preferences, language, theme persistence.
- `messages.ts`: Chat session persistence and retrieval.
- `newsletter.ts`: Newsletter subscription toggles.
- `export.ts`: GDPR data export functionality.

## Best Practices

- **No SSR Data Fetching**: Do not use `Astro.locals` or Astro middleware for Supabase data fetching unless explicitly required for a server-rendered route. Assume the shell is static and data is fetched client-side.
- **Store Synchronization**: Always synchronize successful Supabase mutations with the `store` to trigger UI updates.
- **Fail Gracefully**: The website must remain functional (in a degraded state) if `isSupabaseConfigured` is false.
- **Self-Healing**: If modifying these core files, check `context7` for the latest Supabase JS paradigms and update this skill.
