<script setup lang="ts">
/**
 * The page beside the conversation: an artifact the assistant published or
 * a service tool's view (MCP Apps), in a sandboxed iframe without origin or
 * network. Resizable on wide screens, the whole screen on phones; versions,
 * full screen, and the user's confirmation when the page wants to do
 * something only they can allow.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { store } from '../app/store';
import { locale } from '../app/locale';
import { api, type PageDoc } from '../api';
import { PageHost } from '../actions/pageHost';
import { closePage, openPage, setPageFullscreen } from '../actions/pages';
import { systemTheme } from '../actions/theme';
import AppIcon from './AppIcon.vue';

const t = computed(() => locale.value.pages);
const open = computed(() => store.state.openPage);
const theme = computed<'light' | 'dark'>(() => (store.state.themeMode === 'system' ? systemTheme.value : store.state.themeMode));

const doc = shallowRef<PageDoc | null>(null);
const error = ref<string | null>(null);
const frame = ref<HTMLIFrameElement | null>(null);
let host: PageHost | null = null;

/** A call waiting for the user: its text and how to answer. */
const asking = ref<{ message: string; answer: (yes: boolean) => void } | null>(null);

const load = async () => {
  const o = open.value;
  host?.teardown('another page or version');
  host = null;
  asking.value?.answer(false);
  if (!o) {
    doc.value = null;
    return;
  }
  error.value = null;
  try {
    const d = await api.pages.get(o.id, { version: o.version ?? undefined, theme: theme.value });
    if (store.state.openPage?.id !== o.id) return; // closed or switched meanwhile
    host = new PageHost(() => frame.value?.contentWindow ?? null, d, {
      theme: () => theme.value,
      lang: () => store.state.localeKey,
      confirm: (message) =>
        new Promise<boolean>((resolve) => {
          asking.value?.answer(false);
          asking.value = {
            message,
            answer: (yes) => {
              asking.value = null;
              resolve(yes);
            },
          };
        }),
      openLinkText: (url) => t.value.openLink.replace('{url}', url),
      displayMode: (mode) => {
        setPageFullscreen(mode === 'fullscreen');
        return mode === 'fullscreen' ? 'fullscreen' : 'inline';
      },
      currentDisplayMode: () => (store.state.openPage?.fullscreen ? 'fullscreen' : 'inline'),
    });
    doc.value = d;
  } catch (e) {
    doc.value = null;
    error.value = e instanceof Error ? e.message : String(e);
  }
};

watch(() => [open.value?.id, open.value?.version, open.value?.rev], load, { immediate: true });
watch(theme, () => host?.themeChanged());
watch(() => open.value?.fullscreen, () => host?.displayModeChanged());
// The page belongs to its conversation: switching away closes it.
watch(
  () => store.state.activeConversationId,
  (id) => {
    if (doc.value && doc.value.conversation !== id) closePage();
  },
);

const onMessage = (e: MessageEvent) => host?.handle(e);
const onKv = (e: Event) => {
  const d = (e as CustomEvent<{ artifact: string; kv: Record<string, unknown> }>).detail;
  if (d && doc.value && d.artifact === doc.value.id) host?.kvChanged(d.kv);
};
const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && open.value?.fullscreen) setPageFullscreen(false);
};
onMounted(() => {
  window.addEventListener('message', onMessage);
  window.addEventListener('page-kv', onKv);
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage);
  window.removeEventListener('page-kv', onKv);
  window.removeEventListener('keydown', onKey);
  host?.teardown('closed');
});

const versions = computed(() => (doc.value ? Array.from({ length: doc.value.latest }, (_, i) => doc.value!.latest - i) : []));
const pickVersion = (e: Event) => {
  const v = Number((e.target as HTMLSelectElement).value);
  if (doc.value) openPage(doc.value.id, v === doc.value.latest ? null : v);
};

// Width on wide screens: dragged, remembered in this browser.
const WIDTH_KEY = 'plan-ai.pagePanelWidth';
const width = ref(560);
try {
  const w = Number(localStorage.getItem(WIDTH_KEY));
  if (w >= 320) width.value = w;
} catch {
  /* storage unavailable: the default width */
}
const dragging = ref(false);
const startDrag = (e: PointerEvent) => {
  dragging.value = true;
  const startX = e.clientX;
  const start = width.value;
  const move = (m: PointerEvent) => {
    width.value = Math.min(Math.max(320, start + (startX - m.clientX)), Math.round(window.innerWidth * 0.75));
  };
  const up = () => {
    dragging.value = false;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    try {
      localStorage.setItem(WIDTH_KEY, String(width.value));
    } catch {
      /* not remembered */
    }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
};
</script>

<template>
  <aside
    v-if="open"
    :class="['page-panel', { 'is-fullscreen': open.fullscreen, 'is-dragging': dragging }]"
    :style="{ '--page-panel-width': `${width}px` }"
    :aria-label="doc?.title ?? t.loading"
  >
    <div class="page-panel__resize" role="separator" aria-orientation="vertical" :aria-label="t.resize" @pointerdown.prevent="startDrag" />
    <header class="page-panel__head">
      <AppIcon :name="doc?.kind === 'mcp_app' ? 'tool' : 'chart'" class="page-panel__icon" />
      <div class="page-panel__title">
        <span class="truncate font-medium">{{ doc?.title ?? t.loading }}</span>
        <span v-if="doc?.kind === 'mcp_app'" class="page-panel__kind">{{ t.serviceView }}</span>
      </div>
      <select v-if="doc && doc.latest > 1" class="page-panel__version" :value="doc.version" :aria-label="t.version" @change="pickVersion">
        <option v-for="v in versions" :key="v" :value="v">{{ t.versionLabel.replace('{n}', String(v)) }}{{ v === doc.latest ? ` · ${t.latest}` : '' }}</option>
      </select>
      <button type="button" class="page-panel__btn" :aria-label="open.fullscreen ? t.exitFullscreen : t.fullscreen" :title="open.fullscreen ? t.exitFullscreen : t.fullscreen" @click="setPageFullscreen(!open.fullscreen)">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path v-if="open.fullscreen" d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" />
          <path v-else d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
        </svg>
      </button>
      <button type="button" class="page-panel__btn" :aria-label="t.close" :title="t.close" @click="closePage">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></svg>
      </button>
    </header>
    <div class="page-panel__body">
      <p v-if="error" class="page-panel__error">{{ t.failed }} {{ error }}</p>
      <iframe
        v-else-if="doc"
        :key="`${doc.id}:${doc.version}:${open.rev}`"
        ref="frame"
        class="page-panel__frame"
        :title="doc.title"
        sandbox="allow-scripts"
        referrerpolicy="no-referrer"
        allow=""
        :srcdoc="doc.html"
      />
      <p v-else class="page-panel__loading">{{ t.loading }}</p>
      <div v-if="asking" class="page-panel__confirm" role="alertdialog" aria-modal="true" :aria-label="t.confirmTitle">
        <div class="page-panel__confirm-box">
          <p class="font-semibold">{{ t.confirmTitle }}</p>
          <p class="page-panel__confirm-text">{{ asking.message }}</p>
          <div class="flex justify-end gap-2">
            <button type="button" class="page-panel__deny" @click="asking.answer(false)">{{ t.deny }}</button>
            <button type="button" class="page-panel__allow" @click="asking.answer(true)">{{ t.allow }}</button>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
