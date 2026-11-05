<script setup lang="ts">
/** Settings: who is signed in, the newsletter, connectors, MCP apps, data export, account deletion, sign-out. */
import { computed, ref, watch } from 'vue';
import AppIcon from './AppIcon.vue';
import PlanLogo from './PlanLogo.vue';
import McpApps from './McpApps.vue';
import Connectors from './Connectors.vue';
import { store } from '../app/store';
import { locale } from '../app/locale';
import { getLocaleDateString } from '../utils/date';
import { budgetBars } from '../utils/budget';
import { handleSignOut } from '../actions/auth';
import { closeSettingsOverlay } from '../actions/overlay';
import { handleDataExport, handleSettingsNewsletterToggle, requestAccountDeletion } from '../actions/settings';
import { persistMcpPurchases } from '../actions/profile';

const state = store.state;
const profileSection = computed(() => locale.value.settings.sections.profile);
const privacy = computed(() => locale.value.settings.sections.privacy);

const displayName = computed(() => state.userDisplayName?.trim() || state.userEmail || profileSection.value.fields.name);
const email = computed(() => state.userEmail ?? 'Not signed in');

const newsletterChecked = computed(() => state.profile.newsletterStatus === 'subscribed' && state.isAuthenticated);
const newsletterDisabled = computed(() => !state.isAuthenticated || state.profile.newsletterSyncing);
const savingLabel = computed(() => (state.profile.newsletterSyncing ? `${locale.value.settings.savedLabel.replace('Saved', 'Saving')}…` : ''));

const exportDisabled = computed(() => !state.isAuthenticated || state.profile.dataExportInFlight || state.profile.dataExportStatus !== 'idle');
const exportLabel = computed(() => {
  const status = state.profile.dataExportStatus;
  return status === 'started' ? privacy.value.requestDataStarted : status === 'done' ? privacy.value.requestDataDone : privacy.value.requestData;
});

const deletionDisabled = computed(() => !state.isAuthenticated || state.profile.deletionPending);
const deletionNotice = computed(() =>
  state.profile.deletionPending
    ? privacy.value.deleteScheduledInfo.replace('{{date}}', getLocaleDateString(state.profile.deletionRequestedAt, state.localeKey) ?? '30 days')
    : '',
);

const onNewsletterChange = (event: Event) => handleSettingsNewsletterToggle((event.target as HTMLInputElement).checked);

const mcpTexts = computed(() => locale.value.settings.sections.mcp);
const connectorTexts = computed(() => locale.value.settings.sections.connectors);
const mcpUrl = `${window.location.origin}/public/mcp`;
const onMcpPurchasesChange = (event: Event) => void persistMcpPurchases((event.target as HTMLInputElement).checked);

const planTexts = computed(() => locale.value.settings.sections.plan);
const bars = computed(() => {
  const budget = state.budget;
  if (!budget) return [];
  const { input, output } = budgetBars(budget, planTexts.value, state.localeKey);
  return [
    { key: 'input', name: planTexts.value.input, ...input },
    { key: 'output', name: planTexts.value.output, ...output },
  ];
});

type Tab = 'account' | 'connectors' | 'mcp';
const tab = ref<Tab>('account');
const tabs = computed(() => {
  const all: { key: Tab; label: string }[] = [{ key: 'account', label: locale.value.settings.accountTab }];
  if (state.isAuthenticated && !state.awaitingApproval)
    all.push({ key: 'connectors', label: connectorTexts.value.title }, { key: 'mcp', label: mcpTexts.value.title });
  return all;
});
watch(tabs, (list) => {
  if (!list.some((t) => t.key === tab.value)) tab.value = 'account';
});

const signOut = () => {
  closeSettingsOverlay();
  handleSignOut();
};
</script>

<template>
  <div v-if="state.isSettingsOverlayOpen" class="settings-overlay">
    <button class="settings-overlay__backdrop" aria-label="Close overlay" @click.prevent="closeSettingsOverlay" />
    <section class="settings-panel" role="dialog" aria-modal="true" :aria-label="locale.settings.title">
      <button type="button" class="settings-close-button" aria-label="Close" @click.prevent="closeSettingsOverlay">
        <span aria-hidden="true">&times;</span>
      </button>
      <div class="settings-identity">
        <div class="settings-avatar">
          <span class="settings-avatar-fallback"><AppIcon name="user" /></span>
        </div>
        <div class="settings-identity__text">
          <p class="settings-display-name" :title="displayName">{{ displayName }}</p>
          <p class="settings-email" :title="email">{{ email }}</p>
        </div>
      </div>
      <nav v-if="tabs.length > 1" class="settings-tabs" role="tablist">
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          role="tab"
          :aria-selected="tab === t.key"
          :class="['settings-tab', { 'is-active': tab === t.key }]"
          @click.prevent="tab = t.key"
        >
          {{ t.label }}
        </button>
      </nav>
      <div class="settings-body" role="tabpanel">
        <template v-if="tab === 'account'">
          <section class="settings-section">
            <header class="settings-section__header">
              <p class="settings-section__title">{{ profileSection.title }}</p>
              <span v-if="savingLabel" class="settings-section__status">{{ savingLabel }}</span>
            </header>
            <label class="settings-toggle">
              <input
                type="checkbox"
                class="settings-toggle__input"
                :checked="newsletterChecked"
                :disabled="newsletterDisabled"
                @change="onNewsletterChange"
              />
              <span class="settings-toggle__icon" aria-hidden="true">
                <PlanLogo v-if="newsletterChecked" class="settings-toggle__logo" />
              </span>
              <span>{{ profileSection.fields.newsletter }}</span>
            </label>
          </section>
          <template v-if="state.budget">
            <div class="settings-divider" aria-hidden="true" />
            <section class="settings-section settings-plan">
              <header class="settings-section__header">
                <p class="settings-section__title">{{ planTexts.title }}</p>
                <span class="settings-plan__name">{{ state.budget.plan_name }}</span>
              </header>
              <div v-for="bar in bars" :key="bar.key" class="usage">
                <div class="usage__head">
                  <span>{{ bar.name }}</span>
                  <span v-if="bar.unlimited" class="usage__unlimited">{{ planTexts.unlimited }}</span>
                </div>
                <div
                  class="usage__track"
                  role="meter"
                  :aria-label="`${planTexts.title}: ${bar.name}`"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  :aria-valuenow="bar.percent"
                  :aria-valuetext="bar.unlimited ? `${bar.label} (${planTexts.unlimited})` : bar.label"
                >
                  <div :class="['usage__fill', { 'is-unlimited': bar.unlimited, 'is-exhausted': bar.exhausted }]" :style="{ width: bar.unlimited ? '100%' : `${bar.percent}%` }" />
                </div>
                <p class="usage__label">{{ bar.label }}</p>
              </div>
            </section>
          </template>
          <div class="settings-divider" aria-hidden="true" />
          <section class="settings-section settings-privacy">
            <header class="settings-section__header">
              <p class="settings-section__title">{{ privacy.title }}</p>
            </header>
            <div class="settings-privacy-actions">
              <button type="button" class="pill-button settings-action-button" :disabled="exportDisabled" @click.prevent="handleDataExport(locale)">
                {{ exportLabel }}
              </button>
              <button type="button" class="pill-button settings-action-button is-danger" :disabled="deletionDisabled" @click.prevent="requestAccountDeletion(locale)">
                {{ privacy.deleteAccount }}
              </button>
            </div>
            <p v-if="deletionNotice" class="settings-privacy-inline-status">{{ deletionNotice }}</p>
          </section>
        </template>
        <section v-else-if="tab === 'connectors'" class="settings-section" data-testid="settings-connectors">
          <Connectors />
        </section>
        <section v-else class="settings-section" data-testid="settings-mcp">
          <p class="text-xs text-(--text-muted)">{{ mcpTexts.connect }}</p>
          <code class="mt-1 block text-xs break-all select-all">{{ mcpUrl }}</code>
          <label class="settings-toggle mt-3">
            <input
              type="checkbox"
              class="settings-toggle__input"
              :checked="state.profile.mcpPurchases"
              :disabled="state.impersonating"
              @change="onMcpPurchasesChange"
            />
            <span class="settings-toggle__icon" aria-hidden="true">
              <PlanLogo v-if="state.profile.mcpPurchases" class="settings-toggle__logo" />
            </span>
            <span>{{ mcpTexts.purchases }}</span>
          </label>
          <p class="text-xs text-(--text-muted)">{{ mcpTexts.purchasesHelp }}</p>
          <McpApps />
        </section>
      </div>
      <div class="settings-divider" aria-hidden="true" />
      <div class="settings-actions">
        <button type="button" class="pill-button" :disabled="!state.isAuthenticated" @click.prevent="signOut">
          {{ locale.navigation.loginMenu.signOutLabel }}
        </button>
      </div>
    </section>
  </div>
</template>
