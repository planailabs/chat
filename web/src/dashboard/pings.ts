import { api, type StaffPing } from '../chat/api';
import { errorMessage, escapeHtml } from './logic';

const REASON_LABELS: Record<string, { label: string; color: string }> = {
  demo_request:       { label: 'Demo',       color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  callback_request:   { label: 'Callback',   color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  support_escalation: { label: 'Escalation', color: 'bg-red-500/10 text-red-400 border-red-500/20' },
  other:              { label: 'Other',      color: 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20' },
};

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function initPings(container: HTMLElement) {
  const pingList = container.querySelector('.ping-list') as HTMLElement;
  const pingCount = container.querySelector('.ping-count') as HTMLElement;
  const showResolvedCheckbox = container.querySelector('.show-resolved') as HTMLInputElement;

  let pings: StaffPing[] = [];

  async function loadPings() {
    try {
      pings = await api.admin.staffPings(showResolvedCheckbox.checked);
    } catch (error) {
      pingList.innerHTML = `<div class="text-sm text-red-400 py-4 text-center">Error loading pings: ${escapeHtml(errorMessage(error))}</div>`;
      return;
    }
    render();
  }

  function render() {
    pingCount.textContent = `${pings.length} ping${pings.length === 1 ? '' : 's'}`;

    if (pings.length === 0) {
      pingList.innerHTML = '<div class="text-sm opacity-40 py-8 text-center">No pings to show</div>';
      return;
    }

    pingList.innerHTML = '';
    for (const ping of pings) {
      const reason = REASON_LABELS[ping.reason] ?? REASON_LABELS.other;

      const row = document.createElement('div');
      row.className = 'flex items-start justify-between gap-4 px-4 py-3 rounded-lg border border-white/10 hover:border-white/20 transition-colors';

      const rightHtml = ping.resolved_at
        ? '<span class="text-xs px-3 py-1.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20 whitespace-nowrap">Resolved</span>'
        : '<button type="button" class="resolve-btn px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors whitespace-nowrap">Resolve</button>';

      row.innerHTML = `
        <div class="flex flex-col gap-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-xs px-2 py-0.5 rounded-full border ${reason.color}">${reason.label}</span>
            <span class="text-sm font-medium">${escapeHtml(ping.email)}</span>
            <span class="text-xs opacity-30">${relativeTime(ping.created_at)}</span>
          </div>
          <div class="text-sm opacity-70 break-words">${escapeHtml(ping.message)}</div>
        </div>
        <div class="flex-shrink-0 pt-0.5">${rightHtml}</div>
      `;

      row.querySelector<HTMLButtonElement>('.resolve-btn')?.addEventListener('click', async (e) => {
        const target = e.currentTarget as HTMLButtonElement;
        target.textContent = '...';
        target.disabled = true;
        try {
          await api.admin.resolvePing(ping.id);
        } catch (error) {
          console.error('Dashboard: resolving ping failed', error);
          target.textContent = 'Error';
          return;
        }
        if (showResolvedCheckbox.checked) {
          ping.resolved_at = new Date().toISOString();
        } else {
          pings = pings.filter((p) => p.id !== ping.id);
        }
        render();
      });

      pingList.appendChild(row);
    }
  }

  showResolvedCheckbox.addEventListener('change', () => void loadPings());
  void loadPings();
}
