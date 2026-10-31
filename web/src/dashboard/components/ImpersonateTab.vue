<script setup lang="ts">
import { ref } from 'vue';
import { startImpersonation, type UserHit } from '../../chat/api';
import UserSearch from './UserSearch.vue';

const users = ref<UserHit[] | null>(null);
const error = ref<string | null>(null);

const onResults = (hits: UserHit[]) => {
  users.value = hits;
  error.value = null;
};

const openAs = (user: UserHit) => {
  startImpersonation(user.id);
  window.location.href = '/';
};
</script>

<template>
  <div class="flex flex-col gap-6">
    <p class="text-sm opacity-50">
      Search for a user by email, then open the chat UI as that user. The server treats you as that user (read-only) until you stop impersonating from the chat's user menu.
    </p>
    <UserSearch @results="onResults" @error="(message) => (error = message)" />
    <div v-if="error" class="py-4 text-center text-sm text-red-400">Search failed: {{ error }}</div>
    <div v-else-if="users" class="flex flex-col gap-2">
      <div v-if="users.length === 0" class="py-4 text-center text-sm opacity-40">No users found</div>
      <div v-for="u in users" :key="u.id" class="flex items-center justify-between rounded-lg border border-white/10 px-4 py-3 transition-colors hover:border-white/20">
        <div>
          <div class="text-sm font-medium">{{ u.name || u.email }}</div>
          <div class="text-xs opacity-40">{{ u.email }} <span class="font-mono">{{ u.id.slice(0, 8) }}...</span></div>
        </div>
        <button type="button" class="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium transition-colors hover:bg-white/10" @click="openAs(u)">
          Open as user
        </button>
      </div>
    </div>
  </div>
</template>
