import '../chat/style.css';
import { createApp } from 'vue';
import Dashboard from './Dashboard.vue';
import { router } from './router';
import { enforceAdminAccess } from './logic';

void (async () => {
  if (!(await enforceAdminAccess())) return;
  document.getElementById('dashboard-loading')?.remove();
  const app = createApp(Dashboard);
  app.config.errorHandler = (error, _instance, info) => console.error('[dashboard] unhandled error', info, error);
  app.use(router).mount('#dashboard');
})();
