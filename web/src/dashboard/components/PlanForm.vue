<script setup lang="ts">
/** Create a plan, or edit one (its id stays): name and hourly token limits (0 = unlimited). Plans are free. */
import { computed, ref } from 'vue';
import { api, type Plan } from '../../chat/api';
import { errorMessage } from '../logic';
import { emptyPlanForm, planToForm, validatePlanForm, type PlanFormErrors } from '../plans';

const props = defineProps<{ plan: Plan | null; existingIds: string[] }>();
const emit = defineEmits<{ saved: []; cancel: [] }>();

const editing = computed(() => props.plan !== null);
const form = ref(props.plan ? planToForm(props.plan) : emptyPlanForm());
const errors = ref<PlanFormErrors>({});
const failure = ref<string | null>(null);
const saving = ref(false);

const save = async () => {
  const checked = validatePlanForm(form.value, { editing: editing.value, existingIds: props.existingIds });
  errors.value = checked.errors ?? {};
  if (!checked.input) return;
  saving.value = true;
  failure.value = null;
  try {
    await api.admin.putPlan(checked.input);
    emit('saved');
  } catch (e) {
    failure.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
};

const field = 'w-full rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm transition-colors outline-none focus:border-white/30';
</script>

<template>
  <form class="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/5 p-5" novalidate @submit.prevent="save">
    <h3 class="text-base font-semibold">{{ editing ? `Edit plan “${plan?.name}”` : 'New plan' }}</h3>
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <label class="flex flex-col gap-1">
        <span class="text-xs opacity-50">Id</span>
        <input v-model="form.id" name="id" :class="[field, { 'opacity-50': editing }]" :readonly="editing" placeholder="team" autocomplete="off" />
        <span v-if="errors.id" class="text-xs text-red-400">{{ errors.id }}</span>
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-xs opacity-50">Name</span>
        <input v-model="form.name" name="name" :class="field" placeholder="Team" autocomplete="off" />
        <span v-if="errors.name" class="text-xs text-red-400">{{ errors.name }}</span>
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-xs opacity-50">Input tokens per hour (0 = unlimited)</span>
        <input v-model="form.input" name="input" :class="[field, 'font-mono']" inputmode="numeric" autocomplete="off" />
        <span v-if="errors.input" class="text-xs text-red-400">{{ errors.input }}</span>
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-xs opacity-50">Output tokens per hour (0 = unlimited)</span>
        <input v-model="form.output" name="output" :class="[field, 'font-mono']" inputmode="numeric" autocomplete="off" />
        <span v-if="errors.output" class="text-xs text-red-400">{{ errors.output }}</span>
      </label>
    </div>
    <p class="text-xs opacity-40">Limits are per user and rolling hour. Plans are free; assign them to users below.</p>
    <div v-if="failure" class="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{{ failure }}</div>
    <div class="flex justify-end gap-3">
      <button type="button" class="rounded-lg px-4 py-2 text-sm transition-colors hover:bg-white/5" @click="emit('cancel')">Cancel</button>
      <button type="submit" class="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium transition-colors hover:bg-white/20" :disabled="saving">
        {{ saving ? 'Saving...' : 'Save' }}
      </button>
    </div>
  </form>
</template>
