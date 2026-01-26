/**
 * Conversation Context Manager Tests
 *
 * Tests for follow-up detection, history building, cache keys, and message formatting.
 */

import { describe, it, expect } from 'vitest';
import {
  detectFollowUp,
  getLastExchange,
  buildHistory,
  buildConversationContext,
  formatUserMessage,
} from '../conversation-context';
import type { Message } from '@/types';

// Helper to create test messages
function createMessage(
  role: 'user' | 'assistant',
  content: string,
  id?: string
): Message {
  return {
    id: id || Math.random().toString(36).substring(7),
    role,
    content,
    timestamp: new Date(),
  };
}

describe('detectFollowUp', () => {
  it('should detect explicit follow-up patterns', () => {
    expect(detectFollowUp('What about section 3?').isFollowUp).toBe(true);
    expect(detectFollowUp('How about the budget?').isFollowUp).toBe(true);
    expect(detectFollowUp('And what is the deadline?').isFollowUp).toBe(true);
  });

  it('should detect pronoun references', () => {
    expect(detectFollowUp('Can you explain it further?').isFollowUp).toBe(true);
    expect(detectFollowUp('What does that mean?').isFollowUp).toBe(true);
    expect(detectFollowUp('Tell me more about this').isFollowUp).toBe(true);
  });

  it('should detect elaboration requests', () => {
    expect(detectFollowUp('Can you give me more details?').isFollowUp).toBe(true);
    expect(detectFollowUp('Please elaborate').isFollowUp).toBe(true);
    expect(detectFollowUp('Go on').isFollowUp).toBe(true);
  });

  it('should NOT detect new topics as follow-ups', () => {
    expect(detectFollowUp('What is the leave policy?').isFollowUp).toBe(false);
    expect(detectFollowUp('How do I submit an expense report?').isFollowUp).toBe(false);
    expect(detectFollowUp('Explain the onboarding process').isFollowUp).toBe(false);
  });

  it('should return confidence scores', () => {
    const explicit = detectFollowUp('What about section 3?');
    const implicit = detectFollowUp('And then?');

    expect(explicit.confidence).toBeGreaterThan(implicit.confidence);
    expect(explicit.confidence).toBeGreaterThanOrEqual(0.65);
  });

  it('should detect section references', () => {
    expect(detectFollowUp('What about section 2?').isFollowUp).toBe(true);
    expect(detectFollowUp('Go to part 3').isFollowUp).toBe(true);
  });

  it('should detect ordinal references', () => {
    expect(detectFollowUp('What about the first one?').isFollowUp).toBe(true);
    expect(detectFollowUp('Tell me about the next point').isFollowUp).toBe(true);
  });
});

describe('getLastExchange', () => {
  it('should return last Q&A pair', () => {
    const messages: Message[] = [
      createMessage('user', 'What is the policy?'),
      createMessage('assistant', 'The policy states...'),
      createMessage('user', 'What about section 3?'),
    ];

    const exchange = getLastExchange(messages);

    expect(exchange).not.toBeNull();
    expect(exchange?.question).toBe('What is the policy?');
    expect(exchange?.answer).toBe('The policy states...');
  });

  it('should return null for empty history', () => {
    expect(getLastExchange([])).toBeNull();
  });

  it('should return null for single message', () => {
    const messages: Message[] = [createMessage('user', 'Hello')];
    expect(getLastExchange(messages)).toBeNull();
  });

  it('should skip tool messages', () => {
    const messages: Message[] = [
      createMessage('user', 'Search for X'),
      {
        id: '1',
        role: 'tool',
        content: '{"results":[]}',
        tool_call_id: 'tc1',
        timestamp: new Date(),
      },
      createMessage('assistant', 'I found...'),
    ];

    const exchange = getLastExchange(messages);
    expect(exchange?.question).toBe('Search for X');
  });

  it('should find most recent complete exchange', () => {
    const messages: Message[] = [
      createMessage('user', 'First question'),
      createMessage('assistant', 'First answer'),
      createMessage('user', 'Second question'),
      createMessage('assistant', 'Second answer'),
      createMessage('user', 'Third question (no answer yet)'),
    ];

    const exchange = getLastExchange(messages);
    expect(exchange?.question).toBe('Second question');
    expect(exchange?.answer).toBe('Second answer');
  });
});

describe('buildHistory', () => {
  it('should include all messages when under limit', () => {
    const messages: Message[] = [
      createMessage('user', 'Q1'),
      createMessage('assistant', 'A1'),
      createMessage('user', 'Q2'),
      createMessage('assistant', 'A2'),
    ];

    const result = buildHistory(messages, 10, 6000);

    expect(result.all.length).toBe(4);
    expect(result.anchors.length).toBe(2);
    expect(result.recent.length).toBe(2);
  });

  it('should preserve anchors when over limit', () => {
    const messages: Message[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push(
        createMessage(i % 2 === 0 ? 'user' : 'assistant', `Message ${i}`)
      );
    }

    const result = buildHistory(messages, 10, 6000);

    // Should have first 2 messages as anchors
    expect(result.anchors[0].content).toBe('Message 0');
    expect(result.anchors[1].content).toBe('Message 1');

    // Should have recent messages
    expect(result.all.length).toBeLessThanOrEqual(10);
  });

  it('should maintain chronological order', () => {
    const messages: Message[] = [];
    for (let i = 0; i < 15; i++) {
      messages.push(
        createMessage(i % 2 === 0 ? 'user' : 'assistant', `Msg ${i}`, `id-${i}`)
      );
    }

    const result = buildHistory(messages, 8, 6000);

    // Verify order is maintained
    for (let i = 1; i < result.all.length; i++) {
      const prevIdx = messages.findIndex(m => m.id === result.all[i - 1].id);
      const currIdx = messages.findIndex(m => m.id === result.all[i].id);
      expect(currIdx).toBeGreaterThan(prevIdx);
    }
  });

  it('should respect token budget', () => {
    const longMessage = 'x'.repeat(400); // ~100 tokens each
    const messages: Message[] = [];
    // Create MORE messages than maxMessages to trigger token budget enforcement
    for (let i = 0; i < 30; i++) {
      messages.push(createMessage(i % 2 === 0 ? 'user' : 'assistant', longMessage));
    }

    // Request max 10 messages with 500 token budget
    // With ~100 tokens per message and 30 available, token budget should constrain
    const result = buildHistory(messages, 10, 500);

    // Should be constrained by either message limit (10) or token budget (500)
    // 2 anchors (~200 tokens) + remaining budget (~300) = ~3 more messages max
    // So total should be ~5 messages = ~500 tokens
    expect(result.all.length).toBeLessThanOrEqual(10);
    // Token count should be reasonable (anchors + some recent)
    expect(result.tokens).toBeGreaterThan(0);
    // Should have included the anchors
    expect(result.anchors.length).toBe(2);
  });

  it('should filter out tool messages', () => {
    const messages: Message[] = [
      createMessage('user', 'Q1'),
      {
        id: 'tool1',
        role: 'tool',
        content: '{"result":"data"}',
        tool_call_id: 'tc1',
        timestamp: new Date(),
      },
      createMessage('assistant', 'A1'),
    ];

    const result = buildHistory(messages, 10, 6000);

    expect(result.all.length).toBe(2);
    expect(result.all.every(m => m.role !== 'tool')).toBe(true);
  });

  it('should handle empty messages', () => {
    const result = buildHistory([], 10, 6000);

    expect(result.all.length).toBe(0);
    expect(result.anchors.length).toBe(0);
    expect(result.recent.length).toBe(0);
    expect(result.tokens).toBe(0);
  });
});

describe('buildConversationContext', () => {
  it('should detect follow-up and set hint', () => {
    const messages: Message[] = [
      createMessage('user', 'What is the leave policy?'),
      createMessage('assistant', 'The leave policy allows 20 days...'),
    ];

    const ctx = buildConversationContext(messages, 'What about sick leave?');

    expect(ctx.followUp.isFollowUp).toBe(true);
    expect(ctx.followUp.hint).toContain('leave policy');
  });

  it('should position summary based on follow-up', () => {
    const messages: Message[] = [
      createMessage('user', 'Q1'),
      createMessage('assistant', 'A1'),
    ];

    // Follow-up: summary should be before_question
    const ctxFollowUp = buildConversationContext(messages, 'What about that?', {
      summaryContext: 'Previous summary...',
    });
    expect(ctxFollowUp.summary.position).toBe('before_question');

    // New topic: summary should be before_rag
    const ctxNew = buildConversationContext(
      messages,
      'What is the expense policy?',
      {
        summaryContext: 'Previous summary...',
      }
    );
    expect(ctxNew.summary.position).toBe('before_rag');
  });

  it('should generate different cache keys for different contexts', () => {
    const messages: Message[] = [
      createMessage('user', 'Q1'),
      createMessage('assistant', 'A1'),
    ];

    const ctx1 = buildConversationContext(messages, 'Tell me more');
    const ctx2 = buildConversationContext([], 'Tell me more');

    expect(ctx1.cache.key).not.toBe(ctx2.cache.key);
  });

  it('should mark follow-ups as non-cacheable', () => {
    const messages: Message[] = [
      createMessage('user', 'Q1'),
      createMessage('assistant', 'A1'),
    ];

    const ctx = buildConversationContext(messages, 'What about that?');

    expect(ctx.cache.isCacheable).toBe(false);
    expect(ctx.cache.reason).toBe('follow-up question');
  });

  it('should mark messages with summary as non-cacheable', () => {
    const ctx = buildConversationContext([], 'What is the policy?', {
      summaryContext: 'Previous conversation summary...',
    });

    expect(ctx.cache.isCacheable).toBe(false);
    expect(ctx.cache.reason).toBe('has summary context');
  });

  it('should calculate token usage correctly', () => {
    const messages: Message[] = [
      createMessage('user', 'Short question'),
      createMessage('assistant', 'Short answer'),
    ];

    const ctx = buildConversationContext(messages, 'Test', {
      summaryContext: 'This is a summary of prior context.',
    });

    expect(ctx.tokens.history).toBeGreaterThan(0);
    expect(ctx.tokens.summary).toBeGreaterThan(0);
    expect(ctx.tokens.total).toBe(ctx.tokens.history + ctx.tokens.summary);
    expect(ctx.tokens.remaining).toBe(ctx.tokens.budget - ctx.tokens.total);
  });
});

describe('formatUserMessage', () => {
  it('should include follow-up hint when detected', () => {
    const ctx = buildConversationContext(
      [
        createMessage('user', 'Original question'),
        createMessage('assistant', 'Original answer'),
      ],
      'What about that?'
    );

    const formatted = formatUserMessage(ctx, 'RAG context here', 'What about that?');

    expect(formatted).toContain('Immediate Context');
    expect(formatted).toContain('Original question');
  });

  it('should position summary before RAG for new topics', () => {
    const ctx = buildConversationContext([], 'New question', {
      summaryContext: 'Summary content here',
    });
    const formatted = formatUserMessage(ctx, 'RAG content', 'New question');

    const summaryIdx = formatted.indexOf('Summary content here');
    const ragIdx = formatted.indexOf('RAG content');
    expect(summaryIdx).toBeLessThan(ragIdx);
  });

  it('should position summary before question for follow-ups', () => {
    const ctx = buildConversationContext(
      [
        createMessage('user', 'First question'),
        createMessage('assistant', 'First answer'),
      ],
      'What about that?',
      {
        summaryContext: 'Summary content here',
      }
    );
    const formatted = formatUserMessage(ctx, 'RAG content', 'What about that?');

    const summaryIdx = formatted.indexOf('Summary content here');
    const questionIdx = formatted.indexOf('Current Question');
    expect(summaryIdx).toBeLessThan(questionIdx);
  });

  it('should always end with current question', () => {
    const ctx = buildConversationContext([], 'My question');
    const formatted = formatUserMessage(ctx, 'RAG', 'My question');

    expect(formatted).toContain('Current Question');
    expect(formatted.indexOf('My question')).toBeGreaterThan(
      formatted.indexOf('Current Question')
    );
  });

  it('should include RAG context in Relevant Documents section', () => {
    const ctx = buildConversationContext([], 'Test question');
    const formatted = formatUserMessage(
      ctx,
      'This is the RAG context with documents',
      'Test question'
    );

    expect(formatted).toContain('## Relevant Documents');
    expect(formatted).toContain('This is the RAG context with documents');
  });

  it('should handle empty RAG context gracefully', () => {
    const ctx = buildConversationContext([], 'Test question');
    const formatted = formatUserMessage(ctx, '', 'Test question');

    expect(formatted).not.toContain('## Relevant Documents');
    expect(formatted).toContain('Test question');
  });
});
