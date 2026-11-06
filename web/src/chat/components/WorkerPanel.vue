<script setup lang="ts">
/**
 * A worker's transcript beside the conversation: its task, its steps (words,
 * tool calls with their reason, results cut short) and its report; Stop
 * while it works, and a message to follow up with it.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { api, type Worker, type WorkerStep } from '../api';
import { store } from '../app/store';
import { locale } from '../app/locale';
import { closeWorker } from '../actions/pages';
import { renderMarkdown } from '../utils/markdown';

const t = computed(() => locale.value.workers);
const id = computed(() => store.state.openWorker);
const steps = ref<WorkerStep[]>([]);
const info = ref<Worker | null>(null);
const error = ref<string | null>(null);
const draft = ref('');
const sending = ref(false);
const body = ref<HTMLElement | null>(null);

const load = async () => {
  const w = id.value;
  const conversation = store.state.activeConversationId;
  if (!w || !conversation) return;
  try {
    const [tr, list] = await Promise.all([api.workers.get(w), api.workers.list(conversation)]);
    if (store.state.openWorker !== w) return;
    const atEnd = body.value ? body.value.scrollHeight - body.value.scrollTop - body.value.clientHeight < 40 : true;
    steps.value = tr.steps;
    info.value = list.find((x) => x.id === w) ?? null;
    error.value = null;
    await nextTick();
    if (atEnd && body.value) body.value.scrollTop = body.value.scrollHeight;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
};
watch(id, () => {
  steps.value = [];
  info.value = null;
  draft.value = '';
  void load();
}, { immediate: true });
watch(() => store.state.workersRev, () => void load());
// While it works, steps can stream in between events: poll gently too.
const poll = setInterval(() => {
  if (info.value?.state === 'running' || info.value?.state === 'waiting') void load();
}, 4000);
onBeforeUnmount(() => clearInterval(poll));
watch(() => store.state.activeConversationId, () => closeWorker());

const working = computed(() => info.value?.state === 'running' || info.value?.state === 'waiting');
const canMessage = computed(() => info.value !== null && info.value.state !== 'stopped' && !store.state.impersonating);

const stop = async () => {
  if (!id.value) return;
  try {
    await api.workers.stop(id.value);
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
};
const send = async () => {
  const text = draft.value.trim();
  if (!text || !id.value || sending.value) return;
  sending.value = true;
  try {
    await api.workers.message(id.value, text);
    draft.value = '';
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    sending.value = false;
  }
};
</script>

<template>
  <aside v-if="id" class="page-panel worker-panel" :aria-label="info?.task ?? t.title">
    <header class="page-panel__head">
      <span :class="['workers-dot', `is-${info?.state ?? 'running'}`]" :title="info ? t.states[info.state] : ''" />
      <div class="page-panel__title">
        <span class="truncate font-medium">{{ info?.task || t.untitled }}</span>
        <span class="page-panel__kind">{{ t.worker }}<template v-if="info"> · {{ t.states[info.state] }}</template></span>
      </div>
      <button v-if="working && !store.state.impersonating" type="button" class="worker-panel__stop" @click="stop">{{ t.stop }}</button>
      <button type="button" class="page-panel__btn" :aria-label="t.close" :title="t.close" @click="closeWorker">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></svg>
      </button>
    </header>
    <div ref="body" class="worker-panel__body">
      <p v-if="error" class="page-panel__error">{{ error }}</p>
      <p v-if="info?.error" class="page-panel__error">{{ info.error }}</p>
      <template v-for="(s, i) in steps" :key="i">
        <div v-if="s.kind === 'task'" class="worker-step worker-step--task">
          <span class="worker-step__label">{{ t.task }}</span>
          <p class="whitespace-pre-wrap">{{ s.text }}</p>
        </div>
        <div v-else-if="s.kind === 'message'" class="worker-step worker-step--message">
          <p class="whitespace-pre-wrap">{{ s.text }}</p>
        </div>
        <div v-else-if="s.kind === 'text'" class="worker-step chat-markdown" v-html="renderMarkdown(s.text)" />
        <div v-else-if="s.kind === 'tool'" class="worker-step worker-step--tool">
          <span class="tool-run__name">{{ s.tool }}</span>
          <span v-if="s.text" class="worker-step__reason">{{ s.text }}</span>
        </div>
        <details v-else-if="s.kind === 'result'" class="worker-step worker-step--result">
          <summary>{{ t.result }}</summary>
          <pre>{{ s.text }}</pre>
        </details>
      </template>
      <p v-if="working" class="worker-step worker-step--working">{{ info?.state === 'waiting' ? t.waiting : t.working }}</p>
    </div>
    <form v-if="canMessage" class="worker-panel__composer" @submit.prevent="send">
      <input v-model="draft" class="worker-panel__input" :placeholder="t.placeholder" :aria-label="t.placeholder" :disabled="sending" />
      <button type="submit" class="worker-panel__send" :disabled="!draft.trim() || sending">{{ t.send }}</button>
    </form>
  </aside>
</template>
