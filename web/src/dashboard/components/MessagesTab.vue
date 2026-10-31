<script setup lang="ts">
/** The latest messages; refreshed every few seconds while "Live updates" is on. Click a row for the full text. */
import { onActivated, onDeactivated, onMounted, ref, watch } from 'vue';
import { api, type AdminMessage } from '../../chat/api';
import { conversationLabel, errorMessage } from '../logic';
import { live, POLL_INTERVAL_MS } from '../live';
import CopyButton from './CopyButton.vue';

const messages = ref<AdminMessage[]>([]);
const rowLimit = ref(100);
const loading = ref(false);
const error = ref<string | null>(null);
const showPlaceholder = ref(true);
const selected = ref<AdminMessage | null>(null);

/** `placeholder`: replace the table while fetching (not for polls). */
const reload = async (placeholder: boolean) => {
  if (loading.value) return;
  loading.value = true;
  if (placeholder) showPlaceholder.value = true;
  try {
    messages.value = await api.admin.messages(rowLimit.value);
    error.value = null;
  } catch (e) {
    console.error('Dashboard: Fetch error', e);
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
    showPlaceholder.value = false;
  }
};

const preview = (content: string) => content.slice(0, 60) + (content.length > 60 ? '...' : '');

// Live updates: poll while on and this tab is shown.
let timer: ReturnType<typeof setInterval> | null = null;
let shown = true;
const syncPolling = () => {
  const want = live.value && shown;
  if (want && !timer) {
    timer = setInterval(() => void reload(false), POLL_INTERVAL_MS);
    void reload(false);
  } else if (!want && timer) {
    clearInterval(timer);
    timer = null;
  }
};
watch(live, syncPolling);
onActivated(() => {
  shown = true;
  syncPolling();
});
onDeactivated(() => {
  shown = false;
  syncPolling();
});

watch(rowLimit, () => void reload(true));
onMounted(() => void reload(true));

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') selected.value = null;
};
watch(selected, (msg) => (msg ? document.addEventListener('keydown', onKeydown) : document.removeEventListener('keydown', onKeydown)));
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold">Recent Messages</h2>
      <div class="flex items-center gap-2 text-sm">
        <label for="rows-limit" class="opacity-70">Rows shown:</label>
        <select id="rows-limit" v-model.number="rowLimit" class="focus:border-accent rounded border border-white/10 bg-transparent px-2 py-1 outline-none">
          <option v-for="n in [100, 200, 500, 1000]" :key="n" :value="n">{{ n }}</option>
        </select>
      </div>
    </div>

    <div class="overflow-x-auto rounded-lg border border-white/10">
      <table class="w-full border-collapse text-left text-sm">
        <thead class="bg-white/5 text-xs tracking-wider uppercase opacity-70">
          <tr>
            <th class="w-[180px] border-b border-white/10 p-4 font-medium">Time</th>
            <th class="w-[250px] border-b border-white/10 p-4 font-medium">User</th>
            <th class="border-b border-white/10 p-4 font-medium">Message</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-white/5">
          <tr v-if="showPlaceholder" class="animate-pulse">
            <td class="p-4 opacity-50" colspan="3">Loading...</td>
          </tr>
          <tr v-else-if="error && messages.length === 0">
            <td class="p-4 text-red-500" colspan="3">Error loading data: {{ error }}</td>
          </tr>
          <template v-else>
            <tr v-for="msg in messages" :key="msg.id" class="group relative cursor-pointer transition-colors hover:bg-white/5" @click="selected = msg">
              <td class="p-4 text-xs whitespace-nowrap opacity-70">{{ new Date(msg.created_at).toLocaleString() }}</td>
              <td class="p-4">
                <div class="group/email flex items-center gap-2 font-medium">
                  {{ msg.email }}
                  <CopyButton :text="msg.email" title="Copy Email" class="p-1 opacity-0 transition-all group-hover/email:opacity-100 hover:text-cyan-400" />
                </div>
                <div class="font-mono text-xs opacity-50">{{ msg.user_id.slice(0, 8) }}...</div>
              </td>
              <td class="p-4 text-xs">
                <div class="flex items-center gap-2 overflow-hidden">
                  <span class="max-w-[220px] shrink-0 truncate rounded-full border border-white/10 px-2 py-0.5 opacity-60">{{ conversationLabel(msg.conversation) }} · {{ msg.role }}</span>
                  <span class="max-w-[400px] overflow-hidden font-mono text-ellipsis whitespace-nowrap opacity-80">{{ preview(msg.content) }}</span>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    <div class="py-4 text-center text-xs opacity-40">Showing latest records</div>

    <Teleport to="body">
      <div v-if="selected" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" @click.self="selected = null">
        <div class="relative flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-white/10 bg-[#1e1e1e] shadow-2xl">
          <button type="button" class="absolute top-4 right-4 p-2 text-white/50 hover:text-white" @click="selected = null">&#10005;</button>
          <div class="border-b border-white/10 p-6">
            <h3 class="text-lg font-semibold">Full Message</h3>
            <div class="mt-1 flex flex-wrap items-center gap-2 text-xs opacity-50">
              <span>{{ selected.email }}</span>
              <CopyButton :text="selected.email" title="Copy Email" class="p-1 opacity-50 transition-all hover:text-cyan-400 hover:opacity-100" />
              <span class="mx-2 opacity-50">•</span>
              <span>{{ conversationLabel(selected.conversation) }} · {{ selected.role }}</span>
              <span class="mx-2 opacity-50">•</span>
              <span>{{ new Date(selected.created_at).toLocaleString() }}</span>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto bg-black/20 p-6">
            <pre class="font-mono text-sm leading-relaxed whitespace-pre-wrap opacity-90 select-text">{{ selected.content }}</pre>
          </div>
          <div class="flex justify-end border-t border-white/10 p-4">
            <CopyButton
              :text="selected.content"
              label="Copy Message"
              class="flex min-w-[140px] items-center justify-center gap-2 rounded border border-white/5 bg-white/5 px-4 py-2 text-sm whitespace-nowrap transition-colors hover:bg-white/10"
            />
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
