import { getSupabaseClientOrThrow } from '../chat/supabase/client';
import { initCharts, updateCharts } from './charts';

// --- Types ---
export type Message = {
  id: number;
  user_id: string;
  content: string;
  created_at: string;
  role: string;
};

type ProviderIdentity = {
  email?: string;
  identity_data?: {
    email?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type Profile = {
  user_id: string;
  provider_identity?: ProviderIdentity;
  email?: string; // from provider_identity or auth metadata if we had access (we only have profiles table)
};

// --- State ---
let messages: Message[] = [];
let profiles: Map<string, Profile> = new Map();
let rowLimit = 100;
let isLive = false;
let pendingUpdates: Message[] = [];
let hasPending = false;

// --- Elements ---
const tableBody = document.getElementById('messages-table-body');
const liveToggle = document.getElementById('live-toggle');
const liveDot = document.getElementById('live-dot');
const liveText = document.getElementById('live-text');
const limitSelect = document.getElementById('rows-limit') as HTMLSelectElement;

// --- Init ---
export async function initDashboard() {
  console.log('Dashboard: Init');

  // 1. Charts
  initCharts();

  // 2. Initial Fetch
  await reloadData();

  // 3. Realtime
  setupRealtime();

  // 4. Bind Events
  if (limitSelect) {
    limitSelect.addEventListener('change', async (e) => {
      rowLimit = parseInt((e.target as HTMLSelectElement).value);
      console.log('Dashboard: Limit changed to', rowLimit);
      await reloadData();
    });
  }

  if (liveToggle) {
    liveToggle.addEventListener('click', toggleLive);
  }

  // --- Copy Feedback Helper ---
  function showCopyFeedback(btn: HTMLElement) {
    const originalContent = btn.innerHTML;
    const isIconOnly = btn.classList.contains('copy-email-btn');

    // Green checkmark icon
    const checkIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="${isIconOnly ? 12 : 16}" height="${isIconOnly ? 12 : 16}" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

    if (isIconOnly) {
      btn.innerHTML = checkIcon;
    } else {
      // For text button (Modal main copy) - Keep it single line
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

  // Global copy handler (Emails)
  document.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('.copy-email-btn');
    if (btn) {
      const email = (btn as HTMLElement).dataset.email;
      if (email) {
        await navigator.clipboard.writeText(email);
        showCopyFeedback(btn as HTMLElement);
      }
    }
  });

  // Modal Copy (Full Text)
  document
    .getElementById('modal-copy')
    ?.addEventListener('click', async (e) => {
      const content = document.getElementById('modal-content');
      if (content && content.textContent) {
        await navigator.clipboard.writeText(content.textContent);
        showCopyFeedback(e.currentTarget as HTMLElement);
      }
    });
}

async function reloadData() {
  // Show Loading?
  if (tableBody)
    tableBody.innerHTML =
      '<tr class="animate-pulse"><td class="p-4 opacity-50" colspan="3">Refetching...</td></tr>';

  const supabase = getSupabaseClientOrThrow();

  // Fetch Messages
  const { data: msgs, error } = await supabase
    .from('messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(rowLimit);

  if (error) {
    console.error('Dashboard: Fetch error', error);
    if (tableBody)
      tableBody.innerHTML =
        '<tr><td class="p-4 text-red-500" colspan="3">Error loading data</td></tr>';
    return;
  }

  messages = msgs as Message[];

  // Fetch Profiles for these users
  const userIds = Array.from(new Set(messages.map((m) => m.user_id)));
  if (userIds.length > 0) {
    const { data: profs, error: profError } = await supabase
      .from('profiles')
      .select('*')
      .in('user_id', userIds);

    if (!profError && profs) {
      profs.forEach((p: Profile) => profiles.set(p.user_id, p));
    }
  }

  render();
  updateCharts({ messages, profiles: Array.from(profiles.values()) });

  // Clear pending if any (implied by reload)
  pendingUpdates = [];
  hasPending = false;
  updateLiveUI();
}

function render() {
  if (!tableBody) return;
  tableBody.innerHTML = '';

  messages.forEach((msg) => {
    const tr = document.createElement('tr');
    tr.className =
      'hover:bg-white/5 transition-colors cursor-pointer group relative';

    // Date
    const dateStr = new Date(msg.created_at).toLocaleString();

    // User
    const profile = profiles.get(msg.user_id);
    const email =
      profile?.provider_identity?.identity_data?.email ||
      profile?.provider_identity?.email ||
      'Unknown';

    const copyIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

    const userDisplay = `
            <div class="font-medium flex items-center gap-2 group/email">
                ${email}
                <button class="copy-email-btn opacity-0 group-hover/email:opacity-100 p-1 hover:text-cyan-400 transition-all" data-email="${email}" title="Copy Email">
                   ${copyIcon}
                </button>
            </div>
            <div class="text-xs opacity-50 font-mono">${msg.user_id.slice(0, 8)}...</div>`;

    // Content Preview
    const preview =
      msg.content.slice(0, 60) + (msg.content.length > 60 ? '...' : '');
    // Safe text injection

    tr.innerHTML = `
            <td class="p-4 text-xs opacity-70 whitespace-nowrap">${dateStr}</td>
            <td class="p-4">${userDisplay}</td>
            <td class="p-4 text-opacity-80 font-mono text-xs overflow-hidden text-ellipsis whitespace-nowrap max-w-[400px]"></td>
        `;

    // Inject secure text
    const contentCell = tr.lastElementChild as HTMLElement;
    if (contentCell) contentCell.textContent = preview;

    // Click Logic
    tr.addEventListener('click', (e) => {
      // fast exit if clicked copy button
      if ((e.target as HTMLElement).closest('.copy-email-btn')) return;
      openModal(msg, email);
    });

    tableBody.appendChild(tr);
  });
}

function openModal(msg: Message, email: string) {
  const modal = document.getElementById('text-modal');
  const content = document.getElementById('modal-content');
  const meta = document.getElementById('modal-meta');

  if (modal && content && meta) {
    content.textContent = msg.content;

    const copyIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

    meta.innerHTML = `
           <div class="flex items-center gap-2">
             <span>${email}</span>
             <button class="copy-email-btn p-1 hover:text-cyan-400 transition-all opacity-50 hover:opacity-100" data-email="${email}" title="Copy Email">
                 ${copyIcon}
             </button>
             <span class="mx-2 opacity-50">•</span>
             <span>${new Date(msg.created_at).toLocaleString()}</span>
           </div>
        `;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

// --- Realtime ---
function setupRealtime() {
  const supabase = getSupabaseClientOrThrow();
  supabase
    .channel('dashboard-realtime')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      async (payload) => {
        console.log('Realtime: New message', payload.new);
        const newMsg = payload.new as Message;

        if (isLive) {
          messages.unshift(newMsg);
          if (messages.length > rowLimit) messages.pop();

          if (!profiles.has(newMsg.user_id)) {
            // fetch profile logic could be added here
          }

          render();
          updateCharts({ messages, profiles: Array.from(profiles.values()) });
        } else {
          pendingUpdates.push(newMsg);
          hasPending = true;
          updateLiveUI();
          updateCharts({
            messages: [...pendingUpdates, ...messages],
            profiles: Array.from(profiles.values()),
          });
        }
      },
    )
    .subscribe((status, err) => {
      console.log('Realtime Status:', status, err);
      if (status === 'CHANNEL_ERROR') {
        console.error('Realtime Channel Error:', err);
      }
    });
}

function toggleLive() {
  isLive = !isLive;
  if (isLive) {
    // Turning ON
    // Apply pending
    if (pendingUpdates.length > 0) {
      messages = [...pendingUpdates.reverse(), ...messages]; // reverse because push adds to end, need newest first?
      // Wait, payload gives newest. push adds to end. unshift adds to front.
      // When not live: push to pending.
      // When applying: pending (newest at end? or start?)
      // Just reloadData is simpler and consistent.
      reloadData();
    }
  }
  updateLiveUI();
}

function updateLiveUI() {
  if (!liveToggle || !liveDot || !liveText) return;

  if (isLive) {
    liveText.textContent = 'Live updates: ON';
    liveDot.classList.remove('bg-neutral-500', 'bg-green-500');
    liveDot.classList.add('bg-green-500', 'animate-pulse');
    liveToggle.classList.add('bg-white/10');
  } else {
    liveText.textContent = hasPending
      ? 'Live updates: OFF (Pending)'
      : 'Live updates: OFF';
    liveDot.classList.remove('animate-pulse');

    if (hasPending) {
      liveDot.classList.remove('bg-neutral-500');
      liveDot.classList.add('bg-green-500'); // Green dot for notification
    } else {
      liveDot.classList.remove('bg-green-500');
      liveDot.classList.add('bg-neutral-500');
    }
    liveToggle.classList.remove('bg-white/10');
  }
}
