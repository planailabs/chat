/**
 * The chat's routes: `/` is a new chat, `/c/<id>` a conversation; any other
 * path shows a new chat too (the server serves index.html for every path).
 * The conversation itself is opened by the actions (`openConversation`);
 * the router keeps the URL and reports back/forward.
 */

import { createRouter, createWebHistory } from 'vue-router';
import ChatView from './components/ChatView.vue';

export const router = createRouter({
  history: createWebHistory('/'),
  routes: [
    { path: '/', name: 'new-chat', component: ChatView },
    { path: '/c/:id', name: 'conversation', component: ChatView },
    { path: '/:rest(.*)*', component: ChatView },
  ],
});
