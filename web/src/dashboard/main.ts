import '../chat/style.css';
import { createApp } from 'vue';
import Dashboard from './Dashboard.vue';
import { router } from './router';
import { enforceAdminAccess } from './logic';

void (async () => {
  if (!(await enforceAdminAccess())) return;
  document.getElementById('dashboard-loading')?.remove();
  createApp(Dashboard).use(router).mount('#dashboard');
})();
