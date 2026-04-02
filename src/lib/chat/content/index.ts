/**
 * Product Documentation — bundled as raw strings at build time.
 *
 * Each markdown file is imported via Vite's `?raw` suffix so it becomes
 * a plain string constant in the server bundle.  The `lookup` function
 * exposes them to the `get_product_info` tool at runtime.
 */

import overview from './overview.md?raw';
import departments from './departments.md?raw';
import architecture from './architecture.md?raw';
import useCases from './use-cases.md?raw';
import gettingStarted from './getting-started.md?raw';
import faq from './faq.md?raw';

const DOCS: Record<string, string> = {
  overview,
  departments,
  architecture,
  'use-cases': useCases,
  'getting-started': gettingStarted,
  faq,
};

/** All available document IDs. */
export const DOC_IDS = Object.keys(DOCS);

/** Return the raw markdown for a given doc ID, or null if unknown. */
export const lookupProductDoc = (id: string): string | null =>
  DOCS[id] ?? null;
