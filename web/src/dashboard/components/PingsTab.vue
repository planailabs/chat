<script setup lang="ts">
/** Staff pings (demo, callback, escalation requests): resolve them, optionally show the resolved ones. */
import { onMounted, ref, watch } from 'vue';
import { api, type StaffPing } from '../../chat/api';
import { errorMessage, relativeTime } from '../logic';

const REASONS: Record<string, { label: string; color: string }> = {
  demo_request: { label: 'Demo', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  callback_request: { label: 'Callback', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  support_escalation: { label: 'Escalation', color: 'bg-red-500/10 text-red-400 border-red-500/20' },
  other: { label: 'Other', color: 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20' },
};
const reasonOf = (ping: StaffPing) => REASONS[ping.reason] ?? REASONS.other;

const pings = ref<StaffPing[]>([]);
const showResolved = ref(false);
const error = ref<string | null>(null);
/** Per ping: resolving right now, or the resolve failed. */
const resolving = ref<Record<number, 'busy' | 'error'>>({});

const load = async () => {
  try {
    pings.value = await api.admin.staffPings(showResolved.value);
    error.value = null;
  } catch (e) {
    error.value = errorMessage(e);
  }
};

const resolve = async (ping: StaffPing) => {
  resolving.value[ping.id] = 'busy';
  try {
    await api.admin.resolvePing(ping.id);
  } catch (e) {
    console.error('Dashboard: resolving ping failed', e);
    resolving.value[ping.id] = 'error';
    return;
  }
  delete resolving.value[ping.id];
  if (showResolved.value) ping.resolved_at = new Date().toISOString();
  else pings.value = pings.value.filter((p) => p.id !== ping.id);
};

watch(showResolved, () => void load());
onMounted(() => void load());
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center gap-4">
      <label class="flex cursor-pointer items-center gap-2 text-sm select-none">
        <input v-model="showResolved" type="checkbox" class="accent-green-500" />
        <span class="opacity-70">Show resolved</span>
      </label>
      <span class="ml-auto text-xs opacity-40">{{ pings.length }} ping{{ pings.length === 1 ? '' : 's' }}</span>
    </div>

    <div class="flex flex-col gap-3">
      <div v-if="error" class="py-4 text-center text-sm text-red-400">Error loading pings: {{ error }}</div>
      <div v-else-if="pings.length === 0" class="py-8 text-center text-sm opacity-40">No pings to show</div>
      <div v-for="ping in pings" v-else :key="ping.id" class="flex items-start justify-between gap-4 rounded-lg border border-white/10 px-4 py-3 transition-colors hover:border-white/20">
        <div class="flex min-w-0 flex-col gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <span :class="['rounded-full border px-2 py-0.5 text-xs', reasonOf(ping).color]">{{ reasonOf(ping).label }}</span>
            <span class="text-sm font-medium">{{ ping.email }}</span>
            <span class="text-xs opacity-30">{{ relativeTime(ping.created_at) }}</span>
          </div>
          <div class="text-sm break-words opacity-70">{{ ping.message }}</div>
        </div>
        <div class="flex-shrink-0 pt-0.5">
          <span v-if="ping.resolved_at" class="rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1.5 text-xs whitespace-nowrap text-green-400">Resolved</span>
          <button
            v-else
            type="button"
            class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs whitespace-nowrap transition-colors hover:bg-white/10"
            :disabled="resolving[ping.id] === 'busy'"
            @click="resolve(ping)"
          >
            {{ resolving[ping.id] === 'busy' ? '...' : resolving[ping.id] === 'error' ? 'Error' : 'Resolve' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
