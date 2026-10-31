<script setup lang="ts">
/** Copies `text`; shows a check for two seconds (with "Copied!" when it has a label). */
import { ref } from 'vue';
import { copyText } from '../logic';

const props = defineProps<{ text: string; label?: string }>();
const copied = ref(false);

const copy = async () => {
  if (!(await copyText(props.text))) return;
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
};
</script>

<template>
  <button type="button" :class="{ 'border-green-500/50 bg-green-500/10': copied && label }" @click.stop="copy">
    <svg
      v-if="copied"
      xmlns="http://www.w3.org/2000/svg"
      :width="label ? 16 : 12"
      :height="label ? 16 : 12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#4ade80"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
    <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
    <span v-if="label" :class="{ 'font-medium text-green-400': copied }">{{ copied ? 'Copied!' : label }}</span>
  </button>
</template>
