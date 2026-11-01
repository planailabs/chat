<script setup lang="ts">
/**
 * Renders its slot; if rendering it throws, logs the error and shows an error
 * line instead (the rest of the page stays). A new `resetKey` tries again.
 */
import { onErrorCaptured, ref, watch } from 'vue';
import { locale } from '../app/locale';

const props = defineProps<{ resetKey?: string | number | null }>();
const failed = ref(false);

onErrorCaptured((error, _instance, info) => {
  console.error('[ui] rendering failed', info, error);
  failed.value = true;
  return false;
});

watch(
  () => props.resetKey,
  () => {
    failed.value = false;
  },
);
</script>

<template>
  <p v-if="failed" class="ui-error" role="alert">{{ locale.chat.errors.render }}</p>
  <slot v-else />
</template>
