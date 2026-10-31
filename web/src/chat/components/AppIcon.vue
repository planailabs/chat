<script setup lang="ts">
import { computed, useId } from 'vue';
import { ICONS, type IconName } from '../ui/icons';

const props = defineProps<{ name: IconName }>();
const maskId = `globe-${useId()}`;
const body = computed(() => (props.name === 'globe' ? '' : ICONS[props.name]));
</script>

<template>
  <svg v-if="name === 'globe'" viewBox="0 0 24 24" aria-hidden="true">
    <defs>
      <mask :id="maskId">
        <rect width="24" height="24" fill="white" />
        <ellipse cx="12" cy="12" rx="8" ry="11" fill="black" />
        <ellipse cx="12" cy="12" rx="5" ry="9" fill="white" />
        <rect x="2" y="11" width="20" height="2" fill="black" />
      </mask>
    </defs>
    <circle cx="12" cy="12" r="10" fill="currentColor" :mask="`url(#${maskId})`" />
  </svg>
  <!-- eslint-disable-next-line vue/no-v-html -- trusted constants from ui/icons.ts -->
  <svg
    v-else
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="body"
  />
</template>
