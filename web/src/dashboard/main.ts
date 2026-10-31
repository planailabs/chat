import '../chat/style.css';
import { enforceAdminAccess } from './logic.ts';
import { resetActivityZoom } from './charts.ts';
import { initTabs } from './tabs.ts';

(async () => {
  const isAdmin = await enforceAdminAccess();
  if (isAdmin) {
     document.getElementById('dashboard-loading')!.classList.add('hidden');
     document.getElementById('dashboard-root')!.classList.remove('hidden');
     initTabs();
  }
})();

// Chart reset
document.getElementById('chart-reset')?.addEventListener('click', (e) => {
   e.preventDefault();
   resetActivityZoom();
});

// Text modal close handlers
document.getElementById('modal-close')?.addEventListener('click', () => {
   document.getElementById('text-modal')!.classList.add('hidden');
});
document.getElementById('text-modal')?.addEventListener('click', (e) => {
   if ((e.target as HTMLElement).id === 'text-modal') {
      document.getElementById('text-modal')!.classList.add('hidden');
   }
});
