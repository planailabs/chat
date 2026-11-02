<script setup lang="ts">
/** Settings: the apps connected through MCP (disconnect them) and what they recently did. */
import { computed, onMounted, ref } from 'vue';
import { api, type McpApp, type McpCall } from '../api';
import { store } from '../app/store';
import { locale } from '../app/locale';
import { getLocaleDateString } from '../utils/date';

const texts = computed(() => locale.value.settings.sections.mcp);
const apps = ref<McpApp[]>([]);
const calls = ref<McpCall[]>([]);
const failed = ref(false);
const busy = ref<string | null>(null);

const when = (iso: string) => getLocaleDateString(Date.parse(iso), store.state.localeKey) ?? iso;

const load = async () => {
  try {
    [apps.value, calls.value] = await Promise.all([api.mcp.apps(), api.mcp.calls()]);
    failed.value = false;
  } catch (error) {
    console.error('[mcp] loading connected apps failed', error);
    failed.value = true;
  }
};

const disconnect = async (app: McpApp) => {
  busy.value = app.client_id;
  try {
    await api.mcp.disconnect(app.client_id);
    apps.value = apps.value.filter((a) => a.client_id !== app.client_id);
  } catch (error) {
    console.error('[mcp] disconnecting failed', error);
    failed.value = true;
  } finally {
    busy.value = null;
  }
};

onMounted(() => void load());
</script>

<template>
  <div class="mt-3" data-testid="mcp-apps">
    <p class="text-xs font-semibold">{{ texts.apps }}</p>
    <p v-if="failed" class="text-xs text-red-500">{{ texts.loadFailed }}</p>
    <p v-else-if="apps.length === 0" class="text-xs text-(--text-muted)">{{ texts.noApps }}</p>
    <ul v-else class="mt-1 flex flex-col gap-1.5">
      <li v-for="app in apps" :key="app.client_id" class="flex items-center justify-between gap-2 text-xs">
        <span class="min-w-0">
          <span class="font-medium">{{ app.name }}</span>
          <span class="block text-(--text-muted)">
            {{ texts.connected }} {{ when(app.connected_at) }} ·
            {{ app.last_used_at ? `${texts.lastUsed} ${when(app.last_used_at)}` : texts.never }}
          </span>
        </span>
        <button
          type="button"
          class="shrink-0 rounded border border-(--border-muted) px-2 py-0.5 hover:bg-(--surface-hover) disabled:opacity-50"
          :disabled="busy === app.client_id || store.state.impersonating"
          @click="disconnect(app)"
        >
          {{ texts.disconnect }}
        </button>
      </li>
    </ul>
    <template v-if="calls.length">
      <p class="mt-3 text-xs font-semibold">{{ texts.activity }}</p>
      <ul class="mt-1 flex max-h-40 flex-col gap-1 overflow-y-auto">
        <li v-for="(call, i) in calls" :key="i" class="text-xs" :title="call.reason">
          <span :class="call.decision === 'allow' ? 'text-green-600' : 'text-red-500'">
            {{ call.decision === 'allow' ? texts.allowed : texts.refused }}
          </span>
          <span class="font-mono"> {{ call.tool }}</span>
          <span class="text-(--text-muted)"> · {{ call.client }} · {{ when(call.created_at) }}</span>
        </li>
      </ul>
    </template>
  </div>
</template>
