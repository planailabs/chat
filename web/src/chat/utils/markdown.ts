/**
 * Markdown Rendering for Chat Messages
 *
 * Uses `marked` to convert assistant markdown to HTML and DOMPurify to strip
 * anything executable from it before it reaches innerHTML: the assistant's
 * text is model output and must be treated as untrusted.
 * Only used for assistant messages — user messages remain plain text.
 */

import DOMPurify from 'dompurify';
import { Marked } from 'marked';

const marked = new Marked({
  breaks: true,
  gfm: true,
});

// Links open in a new tab without access to this window.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/** Renders markdown to sanitized HTML. */
// No images (one could carry data out in its URL), forms, styles or media:
// a reply is text and links.
const FORBID_TAGS = ['img', 'picture', 'source', 'video', 'audio', 'form', 'input', 'button', 'select', 'textarea', 'style', 'svg', 'math'];

export const renderMarkdown = (text: string): string =>
  DOMPurify.sanitize(marked.parse(text, { async: false }), { FORBID_TAGS, FORBID_ATTR: ['style', 'srcset'] });
