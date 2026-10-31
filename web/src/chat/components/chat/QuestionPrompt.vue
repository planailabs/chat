<script setup lang="ts">
/** ask_question: the question, and for multiple choice its options and Skip (text questions use the composer). */
import { computed, ref, type PropType } from 'vue';
import type { ClientPrompt } from '../../app/state';
import { locale } from '../../app/locale';
import { answerChatQuestion, cancelChatQuestion } from '../../actions/chat';

const props = defineProps({ prompt: { type: Object as PropType<ClientPrompt>, required: true } });

const input = computed(() => props.prompt.input as { type?: string; question?: string; options?: string[] });

/** The option picked: shown selected, all buttons disabled, then answered. */
const chosen = ref<string | null>(null);

const choose = (option: string) => {
  if (chosen.value !== null) return;
  chosen.value = option;
  setTimeout(() => answerChatQuestion(option), 200);
};
</script>

<template>
  <div v-if="input.question" class="flex justify-start">
    <p class="max-w-[min(100%,640px)] text-sm leading-relaxed text-(--text-muted)">{{ input.question }}</p>
  </div>
  <div v-if="input.type === 'multiple_choice' && input.options" class="flex flex-wrap gap-3 text-sm text-(--text-primary)">
    <button
      v-for="option in input.options"
      :key="option"
      type="button"
      :class="['chat-cta-button', { 'is-selected': chosen === option, 'is-disabled': chosen !== null }]"
      :disabled="chosen !== null"
      @click.stop="choose(option)"
    >
      {{ option }}
    </button>
    <button
      type="button"
      :class="['chat-cta-button', 'chat-cta-button--cancel', { 'is-disabled': chosen !== null }]"
      :disabled="chosen !== null"
      @click.stop="cancelChatQuestion"
    >
      {{ locale.chat.skipLabel }}
    </button>
  </div>
</template>
