<script setup lang="ts">
/**
 * Header: sidebar toggle (signed in), logo and version, theme toggle,
 * language menu, sign-in or the user menu; the impersonation banner above.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import AppIcon from './AppIcon.vue';
import PlanLogo from './PlanLogo.vue';
import { store } from '../app/store';
import { locale } from '../app/locale';
import { isDesktop } from '../app/viewport';
import { persistLocaleSelection } from '../app/state';
import { APP_VERSION } from '../constants';
import { locales, supportedLocales, type LocaleKey } from '../content';
import { cycleThemeMode, systemTheme } from '../actions/theme';
import { persistLanguagePreference } from '../actions/profile';
import { handleSignIn, handleSignOut, handleStopImpersonation } from '../actions/auth';
import { openSettingsOverlay } from '../actions/overlay';
import { toggleSidebar } from '../actions/chat';

const state = store.state;
const nav = computed(() => locale.value.navigation);

const sidebarShown = computed(() => (isDesktop.value ? !state.isSidebarCollapsed : state.isSidebarOpen));

/** System: half filled; the first manual mode (opposite of the system's): empty; the other: filled. */
const themeIcon = computed(() => {
  if (state.themeMode === 'system') return 'themeSystem' as const;
  const firstManual = systemTheme.value === 'dark' ? 'light' : 'dark';
  return state.themeMode === firstManual ? ('themeEmpty' as const) : ('themeFilled' as const);
});

const languages = supportedLocales.map((key) => ({ key, name: locales[key].languageNativeName }));

const languageMenu = ref<HTMLElement | null>(null);
const authMenu = ref<HTMLElement | null>(null);

const toggleLanguageMenu = () => store.setState({ isAuthMenuOpen: false, isLanguageMenuOpen: !state.isLanguageMenuOpen });
const toggleAuthMenu = () => store.setState({ isLanguageMenuOpen: false, isAuthMenuOpen: !state.isAuthMenuOpen });

const selectLanguage = (key: LocaleKey) => {
  if (key === state.localeKey) {
    store.setState({ isLanguageMenuOpen: false });
    return;
  }
  store.setState({ localeKey: key, isLanguageMenuOpen: false });
  persistLocaleSelection(key);
  persistLanguagePreference(key);
};

const openSettings = () => {
  store.setState({ isAuthMenuOpen: false });
  openSettingsOverlay();
};

const signOut = () => {
  store.setState({ isAuthMenuOpen: false });
  handleSignOut();
};

const stopImpersonation = () => {
  store.setState({ isAuthMenuOpen: false });
  handleStopImpersonation();
};

// A click outside an open menu closes it.
const onDocumentClick = (event: MouseEvent) => {
  const target = event.target as Node | null;
  const updates: { isLanguageMenuOpen?: boolean; isAuthMenuOpen?: boolean } = {};
  if (state.isLanguageMenuOpen && !languageMenu.value?.contains(target)) updates.isLanguageMenuOpen = false;
  if (state.isAuthMenuOpen && !authMenu.value?.contains(target)) updates.isAuthMenuOpen = false;
  if (Object.keys(updates).length > 0) store.setState(updates);
};
onMounted(() => document.addEventListener('click', onDocumentClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick));
</script>

<template>
  <div>
    <div v-if="state.impersonating" class="w-full border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-center text-xs text-amber-400">
      Impersonating <span class="font-medium">{{ state.userEmail ?? '…' }}</span>
      <button type="button" class="ml-2 underline hover:text-amber-300" @click.stop="stopImpersonation">Exit</button>
    </div>
    <header class="flex w-full items-center justify-between px-4 py-4 md:px-8 md:py-6">
      <div class="flex items-center gap-3">
        <button
          v-if="state.isAuthenticated"
          class="icon-button sidebar-toggle"
          type="button"
          aria-controls="sidebar-region"
          :aria-expanded="sidebarShown"
          :aria-label="sidebarShown ? locale.sidebar.close : locale.sidebar.open"
          @click.stop="toggleSidebar(isDesktop)"
        >
          <AppIcon name="sidebar" class="icon-size" />
        </button>
        <span class="logo-link flex items-center gap-2 text-base font-semibold tracking-tight text-(--text-primary) md:text-lg">
          <PlanLogo class="icon-size" />
          <span class="flex items-baseline gap-2 leading-none">
            <span>plan.ai</span>
            <span class="text-[0.5em] font-bold text-(--text-muted)">{{ APP_VERSION }}</span>
          </span>
        </span>
      </div>

      <div class="flex items-center gap-3 text-sm text-(--text-muted) md:gap-[14px]">
        <div class="relative">
          <button
            class="icon-button tooltip"
            type="button"
            :data-tooltip="nav.themeToggle.tooltip"
            :aria-label="nav.themeToggle.label"
            @click="cycleThemeMode"
          >
            <AppIcon :name="themeIcon" class="icon-size" />
          </button>
        </div>

        <div ref="languageMenu" class="relative">
          <button
            :class="['icon-button', { tooltip: !state.isLanguageMenuOpen }]"
            type="button"
            :aria-label="nav.languageMenu.label"
            aria-haspopup="menu"
            :aria-expanded="state.isLanguageMenuOpen"
            :data-tooltip="state.isLanguageMenuOpen ? undefined : nav.languageMenu.tooltip"
            @click.stop="toggleLanguageMenu"
          >
            <AppIcon name="globe" class="icon-size" />
          </button>
          <div v-if="state.isLanguageMenuOpen" class="dropdown-panel" role="menu">
            <div class="flex flex-col gap-1">
              <button
                v-for="lang in languages"
                :key="lang.key"
                type="button"
                class="dropdown-option"
                role="menuitemradio"
                :aria-checked="state.localeKey === lang.key"
                @click.stop="selectLanguage(lang.key)"
              >
                <span>{{ lang.name }}</span>
                <AppIcon v-if="state.localeKey === lang.key" name="check" class="check-icon" />
              </button>
            </div>
          </div>
        </div>

        <div ref="authMenu" class="relative">
          <button
            v-if="state.isAuthenticated"
            :class="['icon-button', 'avatar-button', { tooltip: !state.isAuthMenuOpen }]"
            type="button"
            aria-haspopup="menu"
            :aria-expanded="state.isAuthMenuOpen"
            :data-tooltip="state.isAuthMenuOpen ? undefined : nav.settingsLabel"
            @click.stop="toggleAuthMenu"
          >
            <span class="avatar-shell avatar-fallback"><AppIcon name="user" class="icon-size" /></span>
          </button>
          <button v-else class="pill-button" type="button" @click.stop="handleSignIn">
            {{ nav.loginMenu.labelLoggedOut }}
          </button>
          <div v-if="state.isAuthMenuOpen && state.isAuthenticated" class="dropdown-panel" role="menu">
            <div class="flex flex-col gap-1">
              <button type="button" class="dropdown-option" @click.stop="openSettings">
                <span>{{ nav.settingsLabel }}</span>
              </button>
              <a v-if="state.isAdmin" href="/dashboard/" class="dropdown-option"><span>Dashboard</span></a>
              <button v-if="state.impersonating" type="button" class="dropdown-option" @click.stop="stopImpersonation">
                <span>Stop impersonation</span>
              </button>
              <button v-else type="button" class="dropdown-option" @click.stop="signOut">
                <span>{{ nav.loginMenu.signOutLabel }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  </div>
</template>
