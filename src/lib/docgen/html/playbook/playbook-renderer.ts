/**
 * Playbook HTML rendering helpers.
 */
import { escapeHtml } from '../markdown/escape';
import type { PlaybookPart } from './playbook-types';

function toUpperHeading(text: string): string {
  return text;
}

export interface PlaybookHtmlParts {
  cardsHtml: string;
  partDetailHtml: string;
}

export function renderPlaybookPartsHtml(parts: PlaybookPart[]): PlaybookHtmlParts {
  const cardsHtml = parts.map((part) => `
<article class="pb-card" id="${part.id}" data-keywords="${escapeHtml((part.title + ' ' + part.topics.map((t) => t.title).join(' ')).toLowerCase())}">
  <button class="pb-card-header" onclick="openPlaybookPart('${part.id}')" aria-label="Open ${escapeHtml(part.partLabel)}">
    <div class="pb-card-top-border" style="background:${part.accentColor};"></div>
    <div class="pb-card-header-inner">
      <div>
        <span class="pb-card-part-label">${escapeHtml(part.partLabel)}</span>
        <h3>${escapeHtml(toUpperHeading(part.title))}</h3>
      </div>
      <span class="pb-card-arrow" aria-hidden="true">&#8594;</span>
    </div>
  </button>
</article>`).join('\n');

  const partDetailHtml = parts.map((part) => {
    const introHtml = part.introHtml
      ? `<div class="pb-part-intro">${part.introHtml}</div>`
      : '';

    const topicRows = part.topics.map((topic) => `
<div class="pb-topic-row" id="${topic.id}" data-keywords="${escapeHtml(topic.keywords)}">
  <button class="pb-topic-header" onclick="togglePlaybookTopic('${topic.id}')" aria-expanded="false">
    <div class="pb-topic-header-left">
      <span class="pb-topic-title">${escapeHtml(topic.title)}</span>
      ${topic.subtitle ? `<span class="pb-topic-subtitle">${escapeHtml(topic.subtitle)}</span>` : ''}
    </div>
    <span class="pb-topic-chevron" aria-hidden="true">&#8250;</span>
  </button>
  <div class="pb-topic-body">${topic.bodyHtml}</div>
</div>`).join('\n');

    const topicListHtml = part.topics.length > 0
      ? `<div class="pb-topic-list">${topicRows}</div>`
      : '';

    return `<template id="pb-part-tmpl-${part.id}">
<div class="pb-part-detail">
  <div class="pb-part-detail-heading">${escapeHtml(part.partLabel)}: ${escapeHtml(toUpperHeading(part.title))}</div>
  ${introHtml}
  ${topicListHtml}
</div>
</template>`;
  }).join('\n');

  return { cardsHtml, partDetailHtml };
}
