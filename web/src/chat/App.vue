<script setup lang="ts">
import { computed } from 'vue';
import { RouterView } from 'vue-router';
import AppHeader from './components/AppHeader.vue';
import AppSidebar from './components/AppSidebar.vue';
import SettingsOverlay from './components/SettingsOverlay.vue';
import PagePanel from './components/PagePanel.vue';
import WorkerPanel from './components/WorkerPanel.vue';
import ErrorBoundary from './components/ErrorBoundary.vue';
import { store } from './app/store';
import { locale } from './app/locale';
import { signOut } from './api';

// The consent line with its two links (trusted locale strings).
const footerMarkup = computed(() => {
  const f = locale.value.footer;
  return f.consent
    .replace(f.termsLabel, `<a class="font-semibold" href="${f.termsUrl}">${f.termsLabel}</a>`)
    .replace(f.privacyLabel, `<a class="font-semibold" href="${f.privacyUrl}">${f.privacyLabel}</a>`);
});
</script>

<template>
  <div class="app-shell flex bg-(--surface-base) text-(--text-primary)">
    <ErrorBoundary :reset-key="store.state.activeConversationId"><AppSidebar /></ErrorBoundary>
    <div class="flex min-w-0 flex-1 flex-col">
      <ErrorBoundary><AppHeader class="shrink-0" /></ErrorBoundary>
      <main v-if="store.state.awaitingApproval" class="flex flex-1 items-center justify-center px-4 py-10" data-testid="awaiting-approval">
        <section class="w-full max-w-md rounded-2xl border border-(--border-muted) bg-(--surface-elevated) p-6 text-center shadow-sm">
          <h1 class="text-lg font-semibold">{{ locale.approval.title }}</h1>
          <p class="mt-3 text-sm text-(--text-muted)">{{ locale.approval.body }}</p>
          <p class="mt-4 text-xs text-(--text-muted)">{{ locale.approval.signedInAs }} {{ store.state.userEmail }}</p>
          <button type="button" class="mt-5 text-sm font-semibold underline" @click="signOut">{{ locale.approval.signOut }}</button>
        </section>
      </main>
      <ErrorBoundary v-else :reset-key="store.state.activeConversationId">
        <RouterView />
      </ErrorBoundary>
      <footer class="shrink-0 px-4 py-3 text-center text-xs text-(--text-muted) md:px-6 md:py-4" v-html="footerMarkup" />
    </div>
    <ErrorBoundary :reset-key="store.state.openPage?.id ?? ''"><PagePanel /></ErrorBoundary>
    <ErrorBoundary :reset-key="store.state.openWorker ?? ''"><WorkerPanel /></ErrorBoundary>
  </div>
  <ErrorBoundary :reset-key="String(store.state.isSettingsOverlayOpen)"><SettingsOverlay /></ErrorBoundary>
</template>
