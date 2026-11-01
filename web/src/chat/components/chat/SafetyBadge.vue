<script setup lang="ts">
/** "Safety check: approved / rejected / couldn't run" (+ "denied" / "asked you"). */
import { computed, type PropType } from 'vue';
import type { SafetyCheck } from '../../api';
import { locale } from '../../app/locale';
import { checkBadge } from '../../actions/chat/toolRuns';

const props = defineProps({ check: { type: Object as PropType<SafetyCheck>, required: true } });
const badge = computed(() => checkBadge(props.check, locale.value));
</script>

<template>
  <span :class="['safety-badge', `safety-badge--${badge.tone}`]">{{ badge.label }}</span>
</template>
