<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, type Stats } from '../../chat/api';
import { errorMessage } from '../logic';
import { activityOptions, chartData, tokensOptions, usersOptions } from '../charts';
import ApexChart from './ApexChart.vue';

const stats = ref<Stats | null>(null);
const error = ref<string | null>(null);
const activityChart = ref<InstanceType<typeof ApexChart> | null>(null);

const cards = computed(() =>
  stats.value
    ? [
        { label: 'Messages Today', value: stats.value.messages_today },
        { label: 'Total Messages', value: stats.value.messages_total },
        { label: 'Active Users Today', value: stats.value.active_users_today },
        { label: 'Unresolved Pings', value: stats.value.unresolved_pings },
        { label: 'Users', value: stats.value.users_total },
      ]
    : [],
);

const data = computed(() => (stats.value ? chartData(stats.value) : null));

onMounted(async () => {
  try {
    stats.value = await api.admin.stats();
  } catch (e) {
    error.value = errorMessage(e);
  }
});

const panel = 'flex h-[400px] flex-col rounded-xl border border-white/10 bg-white/5 p-6 shadow-sm transition-colors hover:border-white/20';
</script>

<template>
  <div class="flex flex-col gap-8">
    <div class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
      <div v-if="error" class="col-span-full text-sm text-red-400">Error loading stats: {{ error }}</div>
      <div v-else-if="!stats" class="animate-pulse rounded-xl border border-white/10 bg-white/5 p-4"><div class="mb-1 text-xs opacity-50">Loading...</div></div>
      <div v-for="card in cards" v-else :key="card.label" class="rounded-xl border border-white/10 bg-white/5 p-4 shadow-sm transition-colors hover:border-white/20">
        <div class="mb-1 text-xs opacity-50">{{ card.label }}</div>
        <div class="text-2xl font-bold tracking-tight">{{ card.value.toLocaleString() }}</div>
      </div>
    </div>

    <section class="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <div :class="panel">
        <div class="mb-4 flex items-center justify-between opacity-70">
          <h3 class="text-sm font-medium">Activity (user messages, hourly, last 48 hours)</h3>
          <div class="flex items-center text-xs opacity-70">
            <span>Drag to zoom</span>
            <span class="mx-2 opacity-50">&bull;</span>
            <span>Hold Shift to pan</span>
            <span class="mx-2 opacity-50">&bull;</span>
            <a href="#" class="underline transition-colors hover:text-white" @click.prevent="activityChart?.resetZoom()">Reset zoom</a>
          </div>
        </div>
        <ApexChart v-if="data" ref="activityChart" :options="activityOptions" :series="data.activity" />
        <div v-else class="flex flex-1 items-center justify-center text-xs opacity-40">Loading chart...</div>
      </div>

      <div :class="panel">
        <h3 class="mb-4 text-sm font-medium opacity-70">Top Users (tokens, last 24 hours)</h3>
        <ApexChart v-if="data" :options="usersOptions" :series="data.users" :update="data.userCategories" />
        <div v-else class="flex flex-1 items-center justify-center text-xs opacity-40">Loading chart...</div>
      </div>
    </section>

    <section class="grid grid-cols-1 gap-8">
      <div :class="panel">
        <h3 class="mb-4 text-sm font-medium opacity-70">Tokens (hourly, last 48 hours)</h3>
        <ApexChart v-if="data" :options="tokensOptions" :series="data.tokens" />
        <div v-else class="flex flex-1 items-center justify-center text-xs opacity-40">Loading chart...</div>
      </div>
    </section>
  </div>
</template>
