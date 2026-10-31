<script setup lang="ts">
/** Search users by email or name (Enter or the button; at least two characters). */
import { ref } from 'vue';
import { api, type UserHit } from '../../chat/api';
import { errorMessage } from '../logic';

const emit = defineEmits<{ results: [users: UserHit[]]; error: [message: string] }>();

const query = ref('');
const searching = ref(false);

const search = async () => {
  const q = query.value.trim();
  if (q.length < 2 || searching.value) return;
  searching.value = true;
  try {
    emit('results', await api.admin.users(q));
  } catch (e) {
    emit('error', errorMessage(e));
  } finally {
    searching.value = false;
  }
};
</script>

<template>
  <div class="flex items-end gap-3">
    <div class="flex-1">
      <label class="mb-1 block text-xs opacity-50">Search by email or name</label>
      <input
        v-model="query"
        type="text"
        placeholder="user@example.com"
        class="w-full rounded-lg border border-white/10 bg-transparent px-4 py-2.5 text-sm transition-colors outline-none focus:border-white/30"
        @keydown.enter="search"
      />
    </div>
    <button
      type="button"
      class="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm transition-colors hover:bg-white/10"
      :disabled="searching"
      @click="search"
    >
      {{ searching ? 'Searching...' : 'Search' }}
    </button>
  </div>
</template>
