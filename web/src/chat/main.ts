import './style.css';
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { store } from './app/store';
import { conversationIdFromPath, useNavigator } from './app/route';
import { startSession } from './actions/auth';
import { openConversation, showCachedChat } from './actions/chat';
import { initTheme } from './actions/theme';

// The actions move the URL through the router.
useNavigator({
  push: (path) => void router.push(path),
  replace: (path) => void router.replace(path),
});

// Back/forward between conversations (and links the router followed).
router.afterEach((to) => {
  if (!store.state.isAuthenticated) return;
  const id = conversationIdFromPath(to.path);
  if (id !== store.state.activeConversationId) void openConversation(id, 'none');
});

// The last known state right away, then the server's.
initTheme();
showCachedChat();

const app = createApp(App);
// Anything a boundary didn't catch (event handlers, watchers) is logged, not fatal.
app.config.errorHandler = (error, _instance, info) => console.error('[ui] unhandled error', info, error);
app.use(router).mount('#app');
void startSession();

// Fade-in on the first visit in this session, once the first render is done.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    document.documentElement.classList.remove('is-first-visit');
  });
});
