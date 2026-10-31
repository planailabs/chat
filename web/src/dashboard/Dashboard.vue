<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
import { TABS } from './router';
import { live } from './live';
</script>

<template>
  <div class="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 p-6">
    <header class="flex flex-col items-start justify-between gap-4 border-b border-white/10 pb-6 md:flex-row md:items-center">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Admin Dashboard</h1>
        <p class="mt-1 text-sm opacity-60">Realtime monitoring &amp; user insights</p>
      </div>
      <div class="flex items-center gap-4">
        <button
          type="button"
          :class="['flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-sm transition-colors hover:bg-white/5', { 'bg-white/10': live }]"
          @click="live = !live"
        >
          <span :class="['h-2 w-2 rounded-full', live ? 'animate-pulse bg-green-500' : 'bg-neutral-500']" />
          <span>Live updates: {{ live ? 'ON' : 'OFF' }}</span>
        </button>
      </div>
    </header>

    <nav class="-mb-2 flex gap-2 overflow-x-auto border-b border-white/10 pb-0">
      <RouterLink
        v-for="tab in TABS"
        :key="tab.name"
        :to="tab.path"
        class="rounded-t-lg border-b-2 border-transparent px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors hover:bg-white/5"
        exact-active-class="!border-white/40 bg-white/10"
      >
        {{ tab.label }}
      </RouterLink>
    </nav>

    <RouterView v-slot="{ Component }">
      <KeepAlive>
        <component :is="Component" />
      </KeepAlive>
    </RouterView>
  </div>
</template>
