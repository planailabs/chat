<script setup lang="ts">
/** Text that is cut after `max` characters, with "Show more" / "Show less". */
import { computed, ref } from 'vue';
import { locale } from '../../app/locale';

const props = withDefaults(defineProps<{ text: string; max?: number }>(), { max: 280 });
const open = ref(false);
const long = computed(() => props.text.length > props.max + 40);
const shown = computed(() => (long.value && !open.value ? `${props.text.slice(0, props.max).trimEnd()}…` : props.text));
</script>

<template>
  <span class="long-text">{{ shown }}</span>
  <button v-if="long" type="button" class="long-text__toggle" :aria-expanded="open" @click="open = !open">
    {{ open ? locale.chat.tool.showLess : locale.chat.tool.showMore }}
  </button>
</template>
