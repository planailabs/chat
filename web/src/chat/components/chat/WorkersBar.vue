<script setup lang="ts">
/**
 * The conversation's workers (sub-agents): a compact count (all, running)
 * that opens their list — each with its state, task, tokens and how long it
 * ran; a row opens the worker's transcript beside the conversation.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api, type Worker } from '../../api';
import { store } from '../../app/store';
import { locale } from '../../app/locale';
import { openWorker } from '../../actions/pages';

const t = computed(() => locale.value.workers);
const workers = ref<Worker[]>([]);
const open = ref(false);
const now = ref(Date.now());
const tick = setInterval(() => (now.value = Date.now()), 1000);
onBeforeUnmount(() => clearInterval(tick));

let loading = 0;
const load = async () => {
  const id = store.state.activeConversationId;
  const mine = ++loading;
  if (!id) {
    workers.value = [];
    return;
  }
  try {
    const list = await api.workers.list(id);
    if (mine === loading) workers.value = list;
  } catch {
    // A failed refresh keeps what was shown; the next event tries again.
  }
};
// Coalesce bursts of events (a worker's steps) into one refresh.
let timer: ReturnType<typeof setTimeout> | null = null;
const loadSoon = () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(load, 300);
};
watch(() => store.state.activeConversationId, () => {
  open.value = false;
  void load();
}, { immediate: true });
watch(() => store.state.workersRev, loadSoon);
onBeforeUnmount(() => timer && clearTimeout(timer));

const running = computed(() => workers.value.filter((w) => w.state === 'running' || w.state === 'waiting').length);
const duration = (w: Worker) => {
  const s = Math.max(0, Math.round(((w.finished_at ? Date.parse(w.finished_at) : now.value) - Date.parse(w.started_at)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};
const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
const label = (w: Worker) => w.task?.trim() || t.value.untitled;

const pick = (w: Worker) => {
  openWorker(w.id);
  open.value = false;
};
const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') open.value = false;
};
</script>

<template>
  <div v-if="workers.length" class="workers-bar" @keydown="onKey">
    <button type="button" class="workers-bar__trigger" :aria-expanded="open" @click="open = !open">
      <span :class="['workers-dot', running ? 'is-running' : 'is-done']" aria-hidden="true" />
      <span>{{ t.count.replace('{n}', String(workers.length)) }}</span>
      <span v-if="running" class="workers-bar__running">· {{ t.running.replace('{n}', String(running)) }}</span>
    </button>
    <ul v-if="open" class="workers-list" role="listbox" :aria-label="t.title">
      <li v-for="w in workers" :key="w.id">
        <button type="button" :class="['workers-row', { 'is-open': store.state.openWorker === w.id }]" role="option" @click="pick(w)">
          <span :class="['workers-dot', `is-${w.state}`]" :title="t.states[w.state]" />
          <span class="workers-row__task">{{ label(w) }}</span>
          <span class="workers-row__meta">
            <span>{{ tokens(w.tokens) }}</span>
            <span>{{ duration(w) }}</span>
          </span>
          <span class="workers-row__open" aria-hidden="true">›</span>
        </button>
      </li>
    </ul>
  </div>
</template>
