/**
 * Chat Input DOM Utilities
 *
 * Pure DOM manipulation helpers for contentEditable chat input with
 * inline @agent (green) and /command (blue) mention spans.
 *
 * Framework-free — no React imports, no state management.
 * All functions operate directly on DOM nodes.
 */

/**
 * Serialize a contentEditable container's contents to a plain-text string.
 *
 * Styled mention spans are converted to their text representation
 * (e.g. <span class="mention-agent">@planner</span> → "@planner").
 * Plain text nodes pass through unchanged. <br> elements become \n.
 */
export function serializeToPlainText(container: HTMLElement): string {
  const parts: string[] = [];
  walkTextNodes(container, parts);
  return parts.join('').replace(/\u00A0/g, ' ').trim();
}

function walkTextNodes(node: Node, parts: string[]): void {
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child.nodeType === Node.TEXT_NODE) {
      parts.push(child.textContent ?? '');
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement;
      if (el.classList.contains('mention-agent') || el.classList.contains('mention-slash')) {
        // Mention spans: use their text content (e.g. "@planner" or "/pdf")
        parts.push(el.textContent ?? '');
      } else if (el.tagName === 'BR') {
        parts.push('\n');
      } else {
        walkTextNodes(el, parts);
      }
    }
  }
}

/**
 * Insert a styled mention span at the current cursor/selection position.
 *
 * If the cursor is currently in the middle of a partial trigger token
 * (e.g. user typed "@pl" before selecting "planner" from the menu),
 * the partial text is removed first, then the styled span is inserted
 * followed by a non-breaking space.
 *
 * @param container The contentEditable div.
 * @param prefix    '@' or '/'.
 * @param value     The mention value (agent id or command key).
 * @param cssClass  CSS class for styling ('mention-agent' or 'mention-slash').
 */
export function insertMentionSpan(
  container: HTMLElement,
  prefix: '@' | '/',
  value: string,
  cssClass: string
): void {
  container.focus();

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;

  const range = sel.getRangeAt(0);

  // If the cursor is inside a text node with a partial token before it,
  // delete the partial token back to the trigger character.
  if (range.collapsed && range.startContainer.nodeType === Node.TEXT_NODE) {
    const textNode = range.startContainer as Text;
    const cursorOffset = range.startOffset;
    const textBefore = textNode.textContent?.slice(0, cursorOffset) ?? '';

    // Find the last @ or / before the cursor within this text node.
    const triggerIdx = Math.max(textBefore.lastIndexOf('@'), textBefore.lastIndexOf('/'));
    if (triggerIdx >= 0) {
      // Check that the trigger is at a word boundary (start of string or preceded by space).
      if (triggerIdx === 0 || textBefore[triggerIdx - 1] === ' ') {
        // Delete from trigger char to cursor.
        range.setStart(textNode, triggerIdx);
        range.setEnd(textNode, cursorOffset);
        range.deleteContents();
        // Place cursor where the trigger was.
        sel.removeAllRanges();
        const newRange = document.createRange();
        newRange.setStart(textNode, triggerIdx);
        newRange.collapse(true);
        sel.addRange(newRange);
      }
    }
  }

  // Create the mention span.
  const span = document.createElement('span');
  span.textContent = `${prefix}${value}`;
  span.className = cssClass;
  span.contentEditable = 'false';
  span.setAttribute('data-mention', value);
  span.setAttribute('data-prefix', prefix);

  // Insert the span at the current cursor position.
  const finalSel = window.getSelection();
  if (!finalSel || finalSel.rangeCount === 0) return;
  const finalRange = finalSel.getRangeAt(0);

  finalRange.insertNode(span);

  // Move cursor after the span and insert a space.
  finalRange.setStartAfter(span);
  finalRange.collapse(true);
  finalSel.removeAllRanges();
  finalSel.addRange(finalRange);

  // Insert a non-breaking space so the user can keep typing.
  document.execCommand('insertText', false, '\u00A0');
}

/**
 * Detect if the cursor is immediately after a partial @mention or /command
 * trigger token within the contentEditable div.
 *
 * Walks backward from the cursor through text nodes (crossing sibling
 * boundaries) to find the start of the current word. If that word begins
 * with @ or /, returns the prefix and the partial query string.
 *
 * @returns The trigger prefix and query string, or nulls if no trigger detected.
 */
export function getCursorToken(
  container: HTMLElement
): { prefix: '@' | '/' | null; query: string } {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) {
    return { prefix: null, query: '' };
  }

  const range = sel.getRangeAt(0);
  let node: Node | null = range.startContainer;
  let offset = range.startOffset;

  // Build the text before the cursor, walking backward through text nodes.
  const parts: string[] = [];

  while (node && node !== container) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (node === range.startContainer) {
        // Only take text before the cursor in the current node.
        parts.unshift(text.slice(0, offset));
      } else {
        parts.unshift(text);
      }
    }

    // Move to previous sibling or parent.
    let prev: Node | null = node.previousSibling;
    while (!prev && node.parentNode && node.parentNode !== container) {
      node = node.parentNode;
      prev = node.previousSibling;
    }
    if (!prev) break;
    node = prev;
    // Walk to the last child of this sibling.
    while (node.lastChild) {
      node = node.lastChild;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      offset = (node.textContent ?? '').length;
    }
  }

  const textBeforeCursor = parts.join('');

  // Match @ or / at a word boundary before the cursor.
  const match = textBeforeCursor.match(/(?:^|\s)([@/])([a-z0-9_-]*)$/i);
  if (!match) return { prefix: null, query: '' };

  const prefix = match[1] as '@' | '/';
  const query = match[2];
  return { prefix, query };
}

/**
 * Rebuild the innerHTML of a contentEditable container from a plain-text
 * string, converting known @agent and /command tokens into styled spans.
 *
 * Used when restoring a draft that may contain @mentions or /commands.
 *
 * @param container        The contentEditable div.
 * @param text             Plain text to render (e.g. from localStorage draft).
 * @param knownAgentIds    Valid agent ids for @mention detection.
 * @param knownCommandKeys Valid slash-command keys for /command detection.
 */
export function renderMentionsFromPlainText(
  container: HTMLElement,
  text: string,
  knownAgentIds: Set<string>,
  knownCommandKeys: Set<string>
): void {
  if (!text) {
    container.innerHTML = '';
    return;
  }

  // Build a combined regex that matches known @agent and /command tokens.
  const patterns: Array<{ regex: RegExp; prefix: string; cssClass: string }> = [];

  if (knownAgentIds.size > 0) {
    const agentPattern = [...knownAgentIds].map(escapeRegex).join('|');
    patterns.push({
      regex: new RegExp(`(?:^|\\s)(@)(${agentPattern})(?=\\s|$)`, 'gi'),
      prefix: '@',
      cssClass: 'mention-agent',
    });
  }

  if (knownCommandKeys.size > 0) {
    const cmdPattern = [...knownCommandKeys].map(escapeRegex).join('|');
    patterns.push({
      regex: new RegExp(`(?:^|\\s)(/)(${cmdPattern})(?=\\s|$)`, 'gi'),
      prefix: '/',
      cssClass: 'mention-slash',
    });
  }

  if (patterns.length === 0) {
    container.textContent = text;
    return;
  }

  // Replace matches with styled spans.
  let html = escapeHtml(text);
  for (const { regex, cssClass } of patterns) {
    html = html.replace(regex, (match, prefix, value) => {
      const leadingSpace = match.startsWith(' ') ? ' ' : '';
      return `${leadingSpace}<span class="${cssClass}" contenteditable="false" data-mention="${value.toLowerCase()}" data-prefix="${prefix}">${prefix}${value}</span>`;
    });
  }

  container.innerHTML = html;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '\u0026amp;')
    .replace(/</g, '\u0026lt;')
    .replace(/>/g, '\u0026gt;')
    .replace(/"/g, '\u0026quot;');
}
