/** The dashboard's tabs, at /dashboard/ (overview) and /dashboard/<tab>/. */
import { createRouter, createWebHistory } from 'vue-router';

export const TABS = [
  { name: 'overview', label: 'Overview', path: '/' },
  { name: 'messages', label: 'Messages', path: '/messages/' },
  { name: 'impersonate', label: 'Impersonate', path: '/impersonate/' },
  { name: 'pings', label: 'Pings', path: '/pings/' },
  { name: 'prompts', label: 'System Prompts', path: '/prompts/' },
] as const;

export const router = createRouter({
  history: createWebHistory('/dashboard/'),
  routes: [
    { path: '/', name: 'overview', component: () => import('./components/OverviewTab.vue') },
    { path: '/messages/', alias: '/messages', name: 'messages', component: () => import('./components/MessagesTab.vue') },
    { path: '/impersonate/', alias: '/impersonate', name: 'impersonate', component: () => import('./components/ImpersonateTab.vue') },
    { path: '/pings/', alias: '/pings', name: 'pings', component: () => import('./components/PingsTab.vue') },
    { path: '/prompts/', alias: '/prompts', name: 'prompts', component: () => import('./components/PromptsTab.vue') },
    { path: '/:rest(.*)*', redirect: '/' },
  ],
});
