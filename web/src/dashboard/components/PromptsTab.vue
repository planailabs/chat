<script setup lang="ts">
/** Per-user system prompt extensions: find a user, then edit or delete theirs. */
import { nextTick, onBeforeUnmount, ref } from 'vue';
import { api, type UserHit } from '../../chat/api';
import { errorMessage } from '../logic';
import UserSearch from './UserSearch.vue';

const users = ref<UserHit[] | null>(null);
const status = ref<{ text: string; ok: boolean } | null>(null);
let statusTimer: ReturnType<typeof setTimeout> | null = null;

const showStatus = (text: string, ok: boolean) => {
  status.value = { text, ok };
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (status.value = null), 4000);
};
onBeforeUnmount(() => statusTimer && clearTimeout(statusTimer));

// ── Modal ──────────────────────────────────────────────────────────────────
const editing = ref<UserHit | null>(null);
const content = ref('');
const loadingExtension = ref(false);
const modalError = ref<string | null>(null);
const busy = ref<'saving' | 'deleting' | null>(null);
const textarea = ref<HTMLTextAreaElement | null>(null);

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') close();
};

const open = async (user: UserHit) => {
  editing.value = user;
  content.value = '';
  modalError.value = null;
  loadingExtension.value = true;
  document.addEventListener('keydown', onKeydown);
  try {
    const [extension] = await api.admin.promptExtension(user.id);
    if (editing.value === user) content.value = extension?.content ?? '';
  } catch (e) {
    modalError.value = `Loading failed: ${errorMessage(e)}`;
  } finally {
    loadingExtension.value = false;
  }
  await nextTick();
  textarea.value?.focus();
};

const close = () => {
  editing.value = null;
  document.removeEventListener('keydown', onKeydown);
};
onBeforeUnmount(close);

const save = async () => {
  const user = editing.value;
  const text = content.value.trim();
  if (!user || !text) return;
  busy.value = 'saving';
  try {
    await api.admin.setPromptExtension(user.id, text);
    user.has_extension = true;
    showStatus(`Prompt extension saved for ${user.email}`, true);
    close();
  } catch (e) {
    modalError.value = errorMessage(e);
  } finally {
    busy.value = null;
  }
};

const remove = async () => {
  const user = editing.value;
  if (!user || !confirm(`Remove the prompt extension for ${user.email}?`)) return;
  busy.value = 'deleting';
  try {
    await api.admin.removePromptExtension(user.id);
    user.has_extension = false;
    showStatus(`Prompt extension removed for ${user.email}`, true);
    close();
  } catch (e) {
    modalError.value = errorMessage(e);
  } finally {
    busy.value = null;
  }
};
</script>

<template>
  <div class="flex flex-col gap-6">
    <UserSearch @results="(hits) => (users = hits)" @error="(message) => showStatus(`Search failed: ${message}`, false)" />

    <div v-if="users" class="flex flex-col gap-3">
      <div v-if="users.length === 0" class="py-4 text-center text-sm opacity-40">No users found</div>
      <div v-for="u in users" :key="u.id" class="flex items-center justify-between rounded-lg border border-white/10 px-4 py-3 transition-colors hover:border-white/20">
        <div class="flex items-center gap-3">
          <div>
            <div class="text-sm font-medium">{{ u.email }}</div>
            <div class="font-mono text-xs opacity-40">{{ u.id.slice(0, 16) }}...</div>
          </div>
          <span v-if="u.has_extension" class="rounded-full border border-purple-500/20 bg-purple-500/10 px-2 py-0.5 text-xs text-purple-400">Prompt extension</span>
          <span v-else class="rounded-full border border-white/5 bg-white/5 px-2 py-0.5 text-xs opacity-40">No extension</span>
        </div>
        <button type="button" class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs transition-colors hover:bg-white/10" @click="open(u)">Edit Prompt</button>
      </div>
    </div>

    <div v-if="status" :class="['rounded-lg py-2 text-center text-sm', status.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400']">{{ status.text }}</div>

    <Teleport to="body">
      <div v-if="editing" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" @click.self="close">
        <div class="flex w-full max-w-lg flex-col rounded-xl border border-white/10 bg-[var(--surface-base,#1e1e1e)] shadow-2xl">
          <div class="border-b border-white/10 p-6">
            <h3 class="text-lg font-semibold">System Prompt Extension</h3>
            <div class="mt-1 text-xs opacity-50">{{ editing.email }} ({{ editing.id.slice(0, 12) }}...)</div>
          </div>
          <div class="flex flex-col gap-4 p-6">
            <div>
              <label for="prompt-ext-content" class="mb-1 block text-xs opacity-50">Prompt extension</label>
              <textarea
                id="prompt-ext-content"
                ref="textarea"
                v-model="content"
                rows="10"
                :placeholder="loadingExtension ? 'Loading...' : 'Additional system prompt instructions for this user...'"
                class="min-h-[160px] w-full resize-y rounded-lg border border-white/10 bg-transparent px-4 py-2.5 font-mono text-sm transition-colors outline-none focus:border-white/30"
              />
            </div>
            <p class="text-xs opacity-40">This text is appended to the built-in system prompt for this user, from their next conversation on.</p>
            <div v-if="modalError" class="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{{ modalError }}</div>
          </div>
          <div class="flex justify-end gap-3 border-t border-white/10 p-4">
            <button type="button" class="rounded-lg px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/10" :disabled="busy !== null" @click="remove">
              {{ busy === 'deleting' ? 'Deleting...' : 'Delete' }}
            </button>
            <div class="flex-1" />
            <button type="button" class="rounded-lg px-4 py-2 text-sm transition-colors hover:bg-white/5" @click="close">Cancel</button>
            <button type="button" class="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium transition-colors hover:bg-white/20" :disabled="busy !== null" @click="save">
              {{ busy === 'saving' ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
