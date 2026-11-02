<script setup lang="ts">
/** Accounts waiting for an admin: until approved they can sign in but not chat. */
import { onMounted, ref } from 'vue';
import { api, type UserHit } from '../../chat/api';
import { errorMessage, relativeTime } from '../logic';

const users = ref<UserHit[]>([]);
const error = ref<string | null>(null);
/** Per user: approving right now, or the approval failed. */
const approving = ref<Record<string, 'busy' | 'error'>>({});

const load = async () => {
  try {
    users.value = await api.admin.pendingUsers();
    error.value = null;
  } catch (e) {
    error.value = errorMessage(e);
  }
};

const approve = async (user: UserHit) => {
  approving.value[user.id] = 'busy';
  try {
    await api.admin.approveUser(user.id);
  } catch (e) {
    console.error('Dashboard: approving the account failed', e);
    approving.value[user.id] = 'error';
    return;
  }
  delete approving.value[user.id];
  users.value = users.value.filter((u) => u.id !== user.id);
};

onMounted(() => void load());
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center gap-4">
      <span class="text-sm opacity-70">New accounts can sign in, but can't chat until you approve them.</span>
      <span class="ml-auto text-xs opacity-40">{{ users.length }} waiting</span>
    </div>

    <div class="flex flex-col gap-3">
      <div v-if="error" class="py-4 text-center text-sm text-red-400">Error loading accounts: {{ error }}</div>
      <div v-else-if="users.length === 0" class="py-8 text-center text-sm opacity-40">Nobody is waiting</div>
      <div v-for="user in users" v-else :key="user.id" class="flex items-center justify-between gap-4 rounded-lg border border-white/10 px-4 py-3 transition-colors hover:border-white/20">
        <div class="flex min-w-0 flex-col gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-medium">{{ user.email }}</span>
            <span v-if="user.name" class="text-sm opacity-60">{{ user.name }}</span>
          </div>
          <span class="text-xs opacity-30">signed up {{ relativeTime(user.created_at) }}</span>
        </div>
        <div class="flex flex-shrink-0 items-center gap-2">
          <span v-if="approving[user.id] === 'error'" class="text-xs text-red-400">Failed</span>
          <button
            type="button"
            class="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-sm text-green-400 transition-colors hover:bg-green-500/20 disabled:opacity-50"
            :disabled="approving[user.id] === 'busy'"
            @click="approve(user)"
          >
            {{ approving[user.id] === 'busy' ? 'Approving…' : 'Approve' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
