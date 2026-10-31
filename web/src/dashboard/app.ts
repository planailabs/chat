import { api, type AdminMessage } from '../chat/api';
import { errorMessage, escapeHtml } from './logic';

/** While live updates are on, the table refreshes this often. */
const POLL_INTERVAL_MS = 5000;

// --- State ---
let messages: AdminMessage[] = [];
let rowLimit = 100;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let loading = false;

// --- Elements (resolved inside initMessages) ---
let tableBody: HTMLElement | null = null;
let liveToggle: HTMLElement | null = null;
let liveDot: HTMLElement | null = null;
let liveText: HTMLElement | null = null;
let limitSelect: HTMLSelectElement | null = null;

const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

// --- Init ---
export async function initMessages() {
  tableBody = document.getElementById('messages-table-body');
  liveToggle = document.getElementById('live-toggle');
  liveDot = document.getElementById('live-dot');
  liveText = document.getElementById('live-text');
  limitSelect = document.getElementById('rows-limit') as HTMLSelectElement;

  limitSelect?.addEventListener('change', async (e) => {
    rowLimit = parseInt((e.target as HTMLSelectElement).value);
    await reloadData(true);
  });

  liveToggle?.addEventListener('click', toggleLive);

  // Copy an email (table rows and the modal)
  document.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.copy-email-btn');
    const email = btn?.dataset.email;
    if (btn && email) {
      await navigator.clipboard.writeText(email);
      showCopyFeedback(btn);
    }
  });

  // Copy the full message from the modal
  document.getElementById('modal-copy')?.addEventListener('click', async (e) => {
    const content = document.getElementById('modal-content');
    if (content?.textContent) {
      await navigator.clipboard.writeText(content.textContent);
      showCopyFeedback(e.currentTarget as HTMLElement);
    }
  });

  updateLiveUI();
  await reloadData(true);
}

function showCopyFeedback(btn: HTMLElement) {
  const originalContent = btn.innerHTML;
  const isIconOnly = btn.classList.contains('copy-email-btn');
  const size = isIconOnly ? 12 : 16;
  const checkIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

  if (isIconOnly) {
    btn.innerHTML = checkIcon;
  } else {
    btn.innerHTML = `${checkIcon} <span class="text-green-400 font-medium">Copied!</span>`;
    btn.classList.add('border-green-500/50', 'bg-green-500/10');
  }

  setTimeout(() => {
    btn.innerHTML = originalContent;
    if (!isIconOnly) {
      btn.classList.remove('border-green-500/50', 'bg-green-500/10');
    }
  }, 2000);
}

/** `showLoading`: replace the table with a placeholder while fetching (not for polls). */
async function reloadData(showLoading: boolean) {
  if (loading) return;
  loading = true;
  if (showLoading && tableBody) {
    tableBody.innerHTML = '<tr class="animate-pulse"><td class="p-4 opacity-50" colspan="3">Loading...</td></tr>';
  }
  try {
    messages = await api.admin.messages(rowLimit);
    render();
  } catch (error) {
    console.error('Dashboard: Fetch error', error);
    if (tableBody) {
      tableBody.innerHTML = `<tr><td class="p-4 text-red-500" colspan="3">Error loading data: ${escapeHtml(errorMessage(error))}</td></tr>`;
    }
  } finally {
    loading = false;
  }
}

function render() {
  if (!tableBody) return;
  tableBody.innerHTML = '';

  for (const msg of messages) {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-white/5 transition-colors cursor-pointer group relative';

    const email = escapeHtml(msg.email);
    const preview = msg.content.slice(0, 60) + (msg.content.length > 60 ? '...' : '');

    tr.innerHTML = `
      <td class="p-4 text-xs opacity-70 whitespace-nowrap">${new Date(msg.created_at).toLocaleString()}</td>
      <td class="p-4">
        <div class="font-medium flex items-center gap-2 group/email">
          ${email}
          <button class="copy-email-btn opacity-0 group-hover/email:opacity-100 p-1 hover:text-cyan-400 transition-all" data-email="${email}" title="Copy Email">
            ${COPY_ICON}
          </button>
        </div>
        <div class="text-xs opacity-50 font-mono">${escapeHtml(msg.user_id.slice(0, 8))}...</div>
      </td>
      <td class="p-4 text-xs">
        <div class="flex items-center gap-2 overflow-hidden">
          <span class="shrink-0 px-2 py-0.5 rounded-full border border-white/10 opacity-60">${escapeHtml(msg.mode)} · ${escapeHtml(msg.role)}</span>
          <span class="preview font-mono opacity-80 overflow-hidden text-ellipsis whitespace-nowrap max-w-[400px]"></span>
        </div>
      </td>
    `;
    (tr.querySelector('.preview') as HTMLElement).textContent = preview;

    tr.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.copy-email-btn')) return;
      openModal(msg);
    });

    tableBody.appendChild(tr);
  }
}

function openModal(msg: AdminMessage) {
  const modal = document.getElementById('text-modal');
  const content = document.getElementById('modal-content');
  const meta = document.getElementById('modal-meta');
  if (!modal || !content || !meta) return;

  content.textContent = msg.content;
  const email = escapeHtml(msg.email);
  meta.innerHTML = `
    <div class="flex items-center gap-2">
      <span>${email}</span>
      <button class="copy-email-btn p-1 hover:text-cyan-400 transition-all opacity-50 hover:opacity-100" data-email="${email}" title="Copy Email">
        ${COPY_ICON}
      </button>
      <span class="mx-2 opacity-50">•</span>
      <span>${escapeHtml(msg.mode)} · ${escapeHtml(msg.role)}</span>
      <span class="mx-2 opacity-50">•</span>
      <span>${new Date(msg.created_at).toLocaleString()}</span>
    </div>
  `;

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

// --- Live updates (polling) ---
function toggleLive() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  } else {
    pollTimer = setInterval(() => void reloadData(false), POLL_INTERVAL_MS);
    void reloadData(false);
  }
  updateLiveUI();
}

function updateLiveUI() {
  if (!liveToggle || !liveDot || !liveText) return;
  const isLive = pollTimer !== null;
  liveText.textContent = isLive ? 'Live updates: ON' : 'Live updates: OFF';
  liveDot.classList.toggle('bg-green-500', isLive);
  liveDot.classList.toggle('animate-pulse', isLive);
  liveDot.classList.toggle('bg-neutral-500', !isLive);
  liveToggle.classList.toggle('bg-white/10', isLive);
}
