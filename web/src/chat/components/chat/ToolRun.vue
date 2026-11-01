<script setup lang="ts">
/**
 * A finished tool call: the assistant's reason for it as its title (the
 * tool's name without one) and the safety check's badge; expanding shows the
 * whole reason, the tool's name and the check's reasoning.
 */
import { computed, type PropType } from 'vue';
import type { ToolRun } from '../../app/state';
import { locale } from '../../app/locale';
import SafetyBadge from './SafetyBadge.vue';

defineProps({ run: { type: Object as PropType<ToolRun>, required: true } });
const t = computed(() => locale.value.chat.tool);
</script>

<template>
  <div class="flex justify-start">
    <details class="tool-run">
      <summary class="tool-run__summary">
        <span class="tool-run__head">
          <span v-if="run.reason" class="tool-run__title">{{ run.reason }}</span>
          <span v-else class="tool-run__name">{{ run.name }}</span>
          <span v-if="run.isError" class="tool-run__failed">{{ t.failed }}</span>
          <SafetyBadge v-if="run.check" :check="run.check" />
        </span>
      </summary>
      <div class="tool-run__body">
        <p><span class="tool-run__label">{{ t.call }}</span> <span class="tool-run__name">{{ run.name }}</span></p>
        <p v-if="run.check">
          <span class="tool-run__label">{{ t.safetyCheck }}:</span>
          {{ run.check.reasoning || t.noReasoning }}
        </p>
      </div>
    </details>
  </div>
</template>
