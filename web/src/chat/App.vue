<script setup lang="ts">
import { computed } from 'vue';
import { RouterView } from 'vue-router';
import AppHeader from './components/AppHeader.vue';
import AppSidebar from './components/AppSidebar.vue';
import SettingsOverlay from './components/SettingsOverlay.vue';
import { locale } from './app/locale';

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
    <AppSidebar />
    <div class="flex min-w-0 flex-1 flex-col">
      <AppHeader class="shrink-0" />
      <RouterView />
      <footer class="shrink-0 px-4 py-3 text-center text-xs text-(--text-muted) md:px-6 md:py-4" v-html="footerMarkup" />
    </div>
  </div>
  <SettingsOverlay />
</template>
