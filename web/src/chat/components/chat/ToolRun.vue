<script setup lang="ts">
/**
 * A finished tool call: its name, "Why: …" (one line) and the safety check's
 * badge; expanding shows the whole reason and the check's reasoning.
 */
import { computed, type PropType } from 'vue';
import type { ToolRun } from '../../app/state';
import { locale } from '../../app/locale';
import SafetyBadge from './SafetyBadge.vue';

const props = defineProps({ run: { type: Object as PropType<ToolRun>, required: true } });
const t = computed(() => locale.value.chat.tool);
const expandable = computed(() => Boolean(props.run.reason || props.run.check));
</script>

<template>
  <div class="flex justify-start">
    <details v-if="expandable" class="tool-run">
      <summary class="tool-run__summary">
        <span class="tool-run__head">
          <span class="tool-run__name">{{ run.name }}</span>
          <span v-if="run.isError" class="tool-run__failed">{{ t.failed }}</span>
          <SafetyBadge v-if="run.check" :check="run.check" />
        </span>
        <span v-if="run.reason" class="tool-run__why">{{ t.why }} {{ run.reason }}</span>
      </summary>
      <div class="tool-run__body">
        <p v-if="run.reason"><span class="tool-run__label">{{ t.why }}</span> {{ run.reason }}</p>
        <p v-if="run.check">
          <span class="tool-run__label">{{ t.safetyCheck }}:</span>
          {{ run.check.reasoning || t.noReasoning }}
        </p>
      </div>
    </details>
    <p v-else class="tool-run tool-run__summary">
      <span class="tool-run__head">
        <span class="tool-run__name">{{ run.name }}</span>
        <span v-if="run.isError" class="tool-run__failed">{{ t.failed }}</span>
      </span>
    </p>
  </div>
</template>
