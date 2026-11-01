<script setup lang="ts">
/** Plans (hourly token budgets, free) and which plan a user is on. */
import { computed, onMounted, ref } from 'vue';
import { api, type Plan, type UserHit } from '../../chat/api';
import { errorMessage } from '../logic';
import { formatNumber, limitText } from '../plans';
import PlanForm from './PlanForm.vue';
import UserSearch from './UserSearch.vue';

const plans = ref<Plan[]>([]);
const error = ref<string | null>(null);
/** The form: a plan being edited, 'new', or closed. */
const editing = ref<Plan | 'new' | null>(null);

const load = async () => {
  try {
    plans.value = await api.admin.plans();
    error.value = null;
  } catch (e) {
    error.value = errorMessage(e);
  }
};
onMounted(() => void load());

const existingIds = computed(() => plans.value.map((p) => p.id));

const onSaved = () => {
  editing.value = null;
  void load();
};

// ── Users ──────────────────────────────────────────────────────────────────
const users = ref<UserHit[] | null>(null);
const searchError = ref<string | null>(null);
/** Per user: saving, saved, or the error. */
const userStatus = ref<Record<string, { state: 'saving' | 'saved' | 'error'; text?: string }>>({});

const setPlan = async (user: UserHit, planId: string) => {
  const previous = user.plan_id;
  user.plan_id = planId;
  userStatus.value[user.id] = { state: 'saving' };
  try {
    await api.admin.setPlan(user.id, planId);
    userStatus.value[user.id] = { state: 'saved' };
    void load();
  } catch (e) {
    user.plan_id = previous;
    userStatus.value[user.id] = { state: 'error', text: errorMessage(e) };
  }
};

const onUsers = (hits: UserHit[]) => {
  users.value = hits;
  searchError.value = null;
};

const onUserPlanChange = (user: UserHit, event: Event) => void setPlan(user, (event.target as HTMLSelectElement).value);

const cell = 'p-4 border-b border-white/5';
</script>

<template>
  <div class="flex flex-col gap-8">
    <section class="flex flex-col gap-4">
      <div class="flex items-center justify-between gap-4">
        <div>
          <h2 class="text-lg font-semibold">Plans</h2>
          <p class="text-xs opacity-50">Hourly token budgets per user. Free; only admins assign them.</p>
        </div>
        <button
          v-if="editing === null"
          type="button"
          class="rounded-lg border border-white/10 bg-white/5 shrink-0 px-4 py-2 text-sm whitespace-nowrap transition-colors hover:bg-white/10"
          @click="editing = 'new'"
        >
          New plan
        </button>
      </div>

      <PlanForm
        v-if="editing !== null"
        :key="editing === 'new' ? 'new' : editing.id"
        :plan="editing === 'new' ? null : editing"
        :existing-ids="existingIds"
        @saved="onSaved"
        @cancel="editing = null"
      />

      <div v-if="error" class="py-4 text-center text-sm text-red-400">Error loading plans: {{ error }}</div>
      <div v-else class="overflow-x-auto rounded-lg border border-white/10">
        <table class="w-full border-collapse text-left text-sm">
          <thead class="bg-white/5 text-xs tracking-wider uppercase opacity-70">
            <tr>
              <th class="border-b border-white/10 p-4 font-medium">Plan</th>
              <th class="border-b border-white/10 p-4 text-right font-medium">Input tokens / hour</th>
              <th class="border-b border-white/10 p-4 text-right font-medium">Output tokens / hour</th>
              <th class="border-b border-white/10 p-4 text-right font-medium">Users</th>
              <th class="border-b border-white/10 p-4" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="plan in plans" :key="plan.id" class="transition-colors hover:bg-white/5">
              <td :class="cell">
                <div class="font-medium">{{ plan.name }}</div>
                <div class="font-mono text-xs opacity-50">{{ plan.id }}</div>
              </td>
              <td :class="[cell, 'text-right font-mono']">{{ limitText(plan.limits.hourly_input_tokens) }}</td>
              <td :class="[cell, 'text-right font-mono']">{{ limitText(plan.limits.hourly_output_tokens) }}</td>
              <td :class="[cell, 'text-right']">{{ formatNumber(plan.users) }}</td>
              <td :class="[cell, 'text-right']">
                <button type="button" class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs transition-colors hover:bg-white/10" @click="editing = plan">
                  Edit
                </button>
              </td>
            </tr>
            <tr v-if="plans.length === 0">
              <td class="p-4 text-center opacity-40" colspan="5">No plans</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="flex flex-col gap-4">
      <div>
        <h2 class="text-lg font-semibold">Users</h2>
        <p class="text-xs opacity-50">Find a user and put them on a plan (their personal team's).</p>
      </div>
      <UserSearch @results="onUsers" @error="(message) => (searchError = message)" />
      <div v-if="searchError" class="py-4 text-center text-sm text-red-400">Search failed: {{ searchError }}</div>
      <div v-else-if="users" class="flex flex-col gap-2">
        <div v-if="users.length === 0" class="py-4 text-center text-sm opacity-40">No users found</div>
        <div v-for="u in users" :key="u.id" class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 px-4 py-3 transition-colors hover:border-white/20">
          <div class="min-w-0">
            <div class="truncate text-sm font-medium">{{ u.name || u.email }}</div>
            <div class="truncate text-xs opacity-40">{{ u.email }} <span class="font-mono">{{ u.id.slice(0, 8) }}...</span></div>
          </div>
          <div class="flex items-center gap-3">
            <span v-if="userStatus[u.id]?.state === 'saving'" class="text-xs opacity-50">Saving...</span>
            <span v-else-if="userStatus[u.id]?.state === 'saved'" class="text-xs text-green-400">Saved</span>
            <span v-else-if="userStatus[u.id]?.state === 'error'" class="text-xs text-red-400">{{ userStatus[u.id]?.text }}</span>
            <label class="sr-only" :for="`plan-${u.id}`">Plan of {{ u.email }}</label>
            <select
              :id="`plan-${u.id}`"
              :value="u.plan_id"
              class="rounded-lg border border-white/10 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-white/30"
              :disabled="userStatus[u.id]?.state === 'saving'"
              @change="onUserPlanChange(u, $event)"
            >
              <option v-if="!plans.some((p) => p.id === u.plan_id)" :value="u.plan_id">{{ u.plan_id }}</option>
              <option v-for="plan in plans" :key="plan.id" :value="plan.id">{{ plan.name }}</option>
            </select>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
