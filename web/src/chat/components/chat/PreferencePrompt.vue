<script setup lang="ts">
/** prompt_preference: the streamed question, Yes / No, the choice, and the streamed follow-up. */
import { computed, type PropType } from 'vue';
import type { ClientPrompt } from '../../app/state';
import { locale } from '../../app/locale';
import { answerPreferencePrompt } from '../../actions/chat';

const props = defineProps({ prompt: { type: Object as PropType<ClientPrompt>, required: true } });

const pref = computed(() => props.prompt.preference!);
const labels = computed(() => locale.value.preferencePrompts[props.prompt.input.preference_id as string]);
const showChoices = computed(() => pref.value.subPhase !== 'streaming_question');
const locked = computed(() => pref.value.ctaLocked ?? false);
const choiceLabel = computed(() => (pref.value.choice === 'yes' ? labels.value?.ctaYesLabel : pref.value.choice === 'no' ? labels.value?.ctaNoLabel : undefined));

const options = computed(() => [
  { value: 'yes' as const, label: labels.value?.ctaYesLabel ?? 'Yes' },
  { value: 'no' as const, label: labels.value?.ctaNoLabel ?? 'No' },
]);
</script>

<template>
  <div class="flex justify-start">
    <p class="max-w-[min(100%,640px)] text-base leading-relaxed text-(--text-primary)">
      {{ pref.visibleQuestionText }}<span v-if="pref.subPhase === 'streaming_question'" class="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-full bg-(--text-muted)" />
    </p>
  </div>
  <div v-if="showChoices" class="flex flex-wrap gap-3 text-sm text-(--text-primary)">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :class="['chat-cta-button', { 'is-disabled': locked, 'is-selected': pref.choice === option.value }]"
      :disabled="locked"
      :aria-disabled="locked"
      :aria-pressed="pref.choice === option.value"
      @click.stop="answerPreferencePrompt(option.value)"
    >
      {{ option.label }}
    </button>
  </div>
  <div v-if="choiceLabel" class="flex justify-end">
    <p class="max-w-[min(100%,640px)] rounded-3xl bg-(--surface-elevated) px-5 py-3 text-base text-(--text-primary)">{{ choiceLabel }}</p>
  </div>
  <div v-if="pref.visibleFollowupText" class="flex justify-start">
    <p class="max-w-[min(100%,640px)] text-base leading-relaxed text-(--text-primary)">
      {{ pref.visibleFollowupText }}<span v-if="pref.subPhase === 'streaming_followup'" class="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-full bg-(--text-muted)" />
    </p>
  </div>
</template>
