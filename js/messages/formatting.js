/**
 * Message Formatting module
 * Contains functions for formatting messages and processing thinking content
 */

/**
 * Format thinking content with HTML for client-side rendering
 * @param {string} text - The text to process
 * @returns {string} The processed text with thinking content formatted
 */
function formatThinkingContent(text) {
  // Handle non-string input
  if (typeof text !== 'string') {
    return text;
  }
  
  // Check if there are any thinking tags
  if (!text.includes('<think>') || !text.includes('</think>')) {
    return text;
  }
  
  // Process thinking tags with a regular expression
  return text.replace(/<think>([\s\S]*?)<\/think>/g, (match, thinkContent) => {
    // If thinking content only contains whitespace/newlines, remove it completely
    if (!thinkContent.trim()) {
      return '';
    }
    // Format thinking content with special styling for rendering in the UI
    return `<div class="thinking-content"><span class="thinking-label">Thinking:</span>${thinkContent}</div>`;
  });
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
      return text.replace(/\n/g, '<br>');
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
    
    return rendered;
  } catch (error) {
    console.error('Error rendering Markdown:', error);
    return text.replace(/\n/g, '<br>');
  }
}

/**
 * Parse the Ollama response to extract the text content
 * @param {string|object} text - The raw response from Ollama API
 * @returns {string} The extracted text content
 */
function parseOllamaResponse(text) {
  // Handle null or undefined input
  if (!text) {
    return '';
  }
  
  // If the input is not a string, convert it to a string
  if (typeof text !== 'string') {
    return text && typeof text === 'object' ? JSON.stringify(text) : String(text || '');
  }
  
  // Try to parse as a JSON object first
  try {
    // For streaming responses, Ollama may return multiple JSON objects
    // Split by newlines and attempt to parse each line
    const lines = text.split('\n').filter(line => line.trim());
    let lastValidResponse = '';
    
    // If there are multiple lines, try to parse each one
    if (lines.length > 0) {
      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          // If we have a valid Ollama response with a text field, use it
          if (json && typeof json.response === 'string') {
            lastValidResponse = json.response;
          }
        } catch (innerErr) {
          // If a line can't be parsed as JSON, ignore it
          console.log("Couldn't parse line as JSON:", line);
        }
      }
      
      // If we found at least one valid response, return it
      if (lastValidResponse) {
        return formatThinkingContent(lastValidResponse);
      }
    }
    
    // If we didn't find any valid responses in lines, try parsing the entire text
    const json = JSON.parse(text);
    
    // Handle the Ollama API response format
    if (json.response) {
      return formatThinkingContent(json.response);
    } else if (json.message) {
      return formatThinkingContent(json.message);
    } else {
      // If we can't find the response field, return an empty string
      // instead of the raw JSON which would be confusing to display
      console.warn("Unknown JSON response format:", json);
      return '';
    }
  } catch (e) {
    // If it's not valid JSON at all, return the raw text
    // This handles cases where the API might return plain text
    return formatThinkingContent(text);
  }
}

// Export functions
export {
  formatThinkingContent,
  containsMarkdown,
  renderMarkdown,
  parseOllamaResponse
};
