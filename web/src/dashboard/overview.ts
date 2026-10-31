import { api } from '../chat/api';
import { initCharts, updateCharts } from './charts';
import { errorMessage, escapeHtml } from './logic';

export async function initOverview(container: HTMLElement) {
  const statsGrid = container.querySelector('.stats-grid') as HTMLElement;
  initCharts();

  let stats;
  try {
    stats = await api.admin.stats();
  } catch (error) {
    statsGrid.innerHTML = `<div class="col-span-full text-sm text-red-400">Error loading stats: ${escapeHtml(errorMessage(error))}</div>`;
    return;
  }

  const cards = [
    { label: 'Messages Today', value: stats.messages_today },
    { label: 'Total Messages', value: stats.messages_total },
    { label: 'Active Users Today', value: stats.active_users_today },
    { label: 'Unresolved Pings', value: stats.unresolved_pings },
    { label: 'Users', value: stats.users_total },
  ];

  statsGrid.innerHTML = cards
    .map(
      (s) => `
      <div class="p-4 rounded-xl border border-white/10 bg-white/5 shadow-sm hover:border-white/20 transition-colors">
        <div class="text-xs opacity-50 mb-1">${s.label}</div>
        <div class="text-2xl font-bold tracking-tight">${s.value.toLocaleString()}</div>
      </div>
    `,
    )
    .join('');

  updateCharts(stats);
}
