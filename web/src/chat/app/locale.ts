import { computed } from 'vue';
import { store } from './store';
import { locales, type LocaleContent } from '../content';

/** The texts in the user's language. */
export const locale = computed<LocaleContent>(() => locales[store.state.localeKey]);
