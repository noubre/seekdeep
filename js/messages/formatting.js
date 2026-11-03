/**
 * Message Formatting module
 * Contains functions for formatting messages and processing thinking content
 */
import { splitThinking } from './thinking.js';


/**
 * Sanitize rendered HTML before inserting it into the DOM.
 * This keeps Markdown useful while stripping scriptable tags, inline event
 * handlers, javascript: URLs, and other active content from peers/models.
 * @param {string} html - The rendered HTML string
 * @returns {string} Sanitized HTML
 */
function sanitizeHtml(html) {
  if (typeof html !== 'string') return '';

  const template = document.createElement('template');
  template.innerHTML = html;

  const blockedTags = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META']);
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
  const nodesToRemove = [];

  while (walker.nextNode()) {
    const element = walker.currentNode;
    if (blockedTags.has(element.tagName)) {
      nodesToRemove.push(element);
      continue;
    }

    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on') || value.startsWith('javascript:') || value.startsWith('data:text/html')) {
        element.removeAttribute(attr.name);
      }
    }
  }

  nodesToRemove.forEach(node => node.remove());
  return template.innerHTML;
}

/**
 * Escape plain text before converting newlines to <br>.
 * @param {string} text - Plain text
 * @returns {string} HTML-safe text
 */
function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Check if text appears to contain Markdown
 * @param {string} text - The text to check
 * @returns {boolean} True if the text appears to contain Markdown
 */
function containsMarkdown(text) {
  // Handle non-string input
  if (typeof text !== 'string') {
    return false;
  }
  
  // Look for common Markdown patterns
  const markdownPatterns = [
    /^#+\s+.+$/m,                   // Headers
    /\[.+\]\(.+\)/,                 // Links
    /\*\*.+\*\*/,                   // Bold
    /\*.+\*/,                       // Italic
    /^>\s+.+$/m,                    // Blockquotes
    /^-\s+.+$/m,                    // Unordered lists
    /^[0-9]+\.\s+.+$/m,             // Ordered lists
    /^```[\s\S]*?```$/m,            // Code blocks
    /`[^`\n]+`/,                    // Inline code
    /^---+$/m,                      // Horizontal rules
    /!\[.+\]\(.+\)/,                // Images
    /^(\|[^\|]+\|)+$/m,             // Tables
    /^[^\|]+\|[^\|]+$/m             // Simple tables
  ];

  return markdownPatterns.some(pattern => pattern.test(text));
}

/**
 * Render Markdown into HTML safely
 * @param {string} text - The Markdown text to render
 * @returns {string} The rendered HTML
 */
function renderMarkdown(text) {
  try {
    // Check if the text contains Markdown
    if (!containsMarkdown(text)) {
      return escapeHtml(text).replace(/\n/g, '<br>');
    }
    
    // Handle fenced code blocks before rendering (to preserve them)
    const codeBlocks = [];
    
    // Replace code blocks with placeholders
    const textWithPlaceholders = text.replace(/```([\s\S]*?)```/g, (match, code) => {
      const placeholder = `___CODE_BLOCK_${codeBlocks.length}___`;
      codeBlocks.push(match);
      return placeholder;
    });
    
    // Render Markdown using marked.js (assumed to be globally available)
    let rendered = marked.parse(textWithPlaceholders);
    
    // Replace placeholders with actual code blocks
    codeBlocks.forEach((block, index) => {
      const placeholder = `___CODE_BLOCK_${index}___`;
      rendered = rendered.replace(
        placeholder, 
        marked.parse(block)
      );
    });
    
    return sanitizeHtml(rendered);
  } catch (error) {
    console.error('Error rendering Markdown:', error);
    return escapeHtml(text).replace(/\n/g, '<br>');
  }
}

/**
 * Render an assistant response while treating <think> blocks as structured UI.
 * The wrapper HTML is generated locally; model-provided content still passes
 * through the Markdown renderer and sanitizer.
 * @param {string} text - Raw assistant response
 * @returns {string} Sanitized HTML for the message bubble
 */
function renderAssistantContent(text) {
  if (typeof text !== 'string') return '';

  let { thinking: thinkingText, answer: answerText, open } = splitThinking(text);

  if (!thinkingText && !open) {
    // Support messages persisted by the older formatter without trusting its HTML.
    const legacyMatch = text.match(/^<div class="thinking-content"><span class="thinking-label">Thinking:<\/span>\s*([\s\S]*?)<\/div>([\s\S]*)$/);
    if (legacyMatch) {
      thinkingText = legacyMatch[1];
      answerText = legacyMatch[2];
    }
  }

  const thinkingHtml = thinkingText.trim()
    ? `<div class="thinking-content"><span class="thinking-label">Thinking:</span>${renderMarkdown(thinkingText.trim())}</div>`
    : '';

  return thinkingHtml + renderMarkdown(answerText.trimStart());
}

// Export functions
export {
  containsMarkdown,
  renderMarkdown,
  renderAssistantContent,
  sanitizeHtml,
  escapeHtml
};
