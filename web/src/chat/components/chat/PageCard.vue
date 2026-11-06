<script setup lang="ts">
/** A page a tool call made (an artifact, a service's view): opens it beside the conversation. */
import { computed, type PropType } from 'vue';
import type { PageRef } from '../../api';
import { store } from '../../app/store';
import { locale } from '../../app/locale';
import { openPage } from '../../actions/pages';
import AppIcon from '../AppIcon.vue';

const props = defineProps({ page: { type: Object as PropType<PageRef>, required: true } });
const t = computed(() => locale.value.pages);
const isOpen = computed(() => store.state.openPage?.id === props.page.id);
const label = computed(() => {
  const kind = props.page.kind === 'mcp_app' ? t.value.serviceView : t.value.page;
  return props.page.version && props.page.version > 1 ? `${kind} · ${t.value.versionLabel.replace('{n}', String(props.page.version))}` : kind;
});
</script>

<template>
  <div class="flex justify-start">
    <button type="button" :class="['page-card', { 'is-open': isOpen }]" @click="openPage(page.id, null)">
      <AppIcon :name="page.kind === 'mcp_app' ? 'tool' : 'chart'" class="page-card__icon" />
      <span class="page-card__text">
        <span class="page-card__title">{{ page.title }}</span>
        <span class="page-card__label">{{ label }}</span>
      </span>
      <span class="page-card__open">{{ isOpen ? t.shown : t.open }}</span>
    </button>
  </div>
</template>
