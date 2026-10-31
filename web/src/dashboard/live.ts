/** "Live updates" (header toggle): the messages table refreshes while on. */
import { ref } from 'vue';

export const POLL_INTERVAL_MS = 5000;

export const live = ref(false);
