/**
 * Sidebar — "New chat", the user's conversations grouped by date, and
 * plan.ai's applications. Desktop: a column that can be collapsed. Mobile:
 * an off-canvas drawer opened from the header.
 */

import type { AppState } from '../app/state';
import type { LocaleContent } from '../content';
import { APPLICATIONS, applicationIcon } from '../content/applications';
import { groupConversations, type ConversationItem } from '../actions/chat/conversationList';
import { pathForConversation } from '../app/route';
import { escapeHtml } from '../utils/html';
import { DELETE_ICON_SVG, EXTERNAL_ICON_SVG, NEW_CHAT_ICON_SVG, RENAME_ICON_SVG } from './icons';

/** The width from which the sidebar is a column rather than a drawer (Tailwind `md`). */
export const DESKTOP_QUERY = '(min-width: 768px)';

export const isDesktopViewport = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DESKTOP_QUERY).matches;

/** Whether the sidebar is visible at the current width. */
export const isSidebarShown = (state: AppState): boolean => (isDesktopViewport() ? !state.isSidebarCollapsed : state.isSidebarOpen);

const renderItem = (c: ConversationItem, state: AppState, locale: LocaleContent): string => {
  const active = c.id === state.activeConversationId;
  const title = escapeHtml(c.title.trim() || '…');
  const readOnly = state.impersonating;

  if (c.id === state.renamingConversationId && !readOnly) {
    return `<li class="sidebar-item is-renaming">
      <input
        class="sidebar-rename-input"
        type="text"
        maxlength="120"
        value="${title}"
        aria-label="${escapeHtml(locale.sidebar.rename)}"
        data-action="rename-input"
        data-id="${c.id}" />
    </li>`;
  }

  const activity = !active && (c.busy || c.unread)
    ? `<span class="sidebar-dot${c.busy ? ' is-busy' : ''}" role="img" aria-label="${escapeHtml(locale.sidebar.activity)}"></span>`
    : '';
  const actions = readOnly
    ? ''
    : `<span class="sidebar-item__actions">
        <button type="button" class="sidebar-item__action" data-action="rename-conversation" data-id="${c.id}" aria-label="${escapeHtml(locale.sidebar.rename)}" title="${escapeHtml(locale.sidebar.rename)}">${RENAME_ICON_SVG}</button>
        <button type="button" class="sidebar-item__action" data-action="delete-conversation" data-id="${c.id}" aria-label="${escapeHtml(locale.sidebar.delete)}" title="${escapeHtml(locale.sidebar.delete)}">${DELETE_ICON_SVG}</button>
      </span>`;

  return `<li class="sidebar-item${active ? ' is-active' : ''}">
    <a
      class="sidebar-item__link"
      href="${pathForConversation(c.id)}"
      data-action="open-conversation"
      data-id="${c.id}"
      ${active ? 'aria-current="page"' : ''}>
      <span class="sidebar-item__title">${title}</span>
      ${activity}
    </a>
    ${actions}
  </li>`;
};

const renderConversations = (state: AppState, locale: LocaleContent): string => {
  const groups = groupConversations(state.conversations);
  if (groups.length === 0) {
    return `<p class="sidebar-empty">${escapeHtml(locale.sidebar.empty)}</p>`;
  }
  return groups
    .map(
      (g) => `<section class="sidebar-group">
        <h2 class="sidebar-heading">${escapeHtml(locale.sidebar.groups[g.key])}</h2>
        <ul class="sidebar-list">${g.items.map((c) => renderItem(c, state, locale)).join('')}</ul>
      </section>`,
    )
    .join('');
};

const renderApplications = (state: AppState, locale: LocaleContent): string => `<nav class="sidebar-apps" aria-label="${escapeHtml(locale.sidebar.applications)}">
    <h2 class="sidebar-heading">${escapeHtml(locale.sidebar.applications)}</h2>
    <ul class="sidebar-list">
      ${APPLICATIONS.map(
        (app) => `<li>
          <a class="sidebar-app" href="${escapeHtml(app.url)}" target="_blank" rel="noopener noreferrer">
            ${applicationIcon(app)}
            <span class="sidebar-item__title">${escapeHtml(app.label[state.localeKey])}</span>
            ${EXTERNAL_ICON_SVG}
            <span class="sr-only">(${escapeHtml(locale.sidebar.newTab)})</span>
          </a>
        </li>`,
      ).join('')}
    </ul>
  </nav>`;

/** The sidebar's markup; empty when signed out. */
export const renderSidebar = (state: AppState, locale: LocaleContent): string => {
  if (!state.isAuthenticated) return '';
  const newChat = state.impersonating
    ? ''
    : `<button type="button" class="sidebar-new-chat" data-action="new-chat">
        ${NEW_CHAT_ICON_SVG}
        <span>${escapeHtml(locale.sidebar.newChat)}</span>
      </button>`;
  return `<div class="sidebar-backdrop" data-action="sidebar-close" aria-hidden="true"></div>
    <div class="sidebar-panel">
      <div class="sidebar-top">${newChat}</div>
      <div class="sidebar-scroll">${renderConversations(state, locale)}</div>
      ${renderApplications(state, locale)}
    </div>`;
};

/** Classes of the sidebar's region (open drawer, collapsed column). */
export const sidebarRegionClass = (state: AppState): string =>
  [
    'sidebar',
    !state.isAuthenticated && 'is-hidden',
    state.isSidebarOpen && 'is-open',
    state.isSidebarCollapsed && 'is-collapsed',
  ]
    .filter(Boolean)
    .join(' ');
