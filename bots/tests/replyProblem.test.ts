import { describe, it, expect } from 'vitest';
import { replyProblem } from '../ai/replyProblem';
import { providerErrorText } from '../ai/providers/ownKeyHttp';

const quiet = { error: false, answered: false, outputTokens: 0, reasoningTokens: 0 };

describe('replyProblem (#1498)', () => {
    it('says nothing about a reply that has an answer', () => {
        expect(replyProblem({ ...quiet, answered: true, outputTokens: 120 })).toBeUndefined();
    });

    it('names a reply that spent the whole limit on thinking', () => {
        expect(replyProblem({ ...quiet, finishReason: 'length', outputTokens: 4000, reasoningTokens: 4000, maxTokens: 4000 })).toBe(
            'no words and no tool call: it reached the longest reply, 4000 tokens used of 4000 allowed, 4000 on thinking'
        );
    });

    it('names an empty reply that simply stopped', () => {
        expect(replyProblem({ ...quiet, finishReason: 'stop' })).toBe('no words and no tool call: it stopped (stop), 0 tokens used, 0 on thinking');
        expect(replyProblem(quiet)).toContain('no reason given');
    });

    it('does not copy a finish reason it does not know', () => {
        expect(replyProblem({ ...quiet, finishReason: 'Bearer abc123 please call 555-0100' })).toBe(
            'no words and no tool call: it stopped (an unrecognised reason), 0 tokens used, 0 on thinking'
        );
        expect(replyProblem({ ...quiet, finishReason: 'STOP' })).toBe('no words and no tool call: it stopped (stop), 0 tokens used, 0 on thinking');
    });

    it('puts the provider error first, with its status', () => {
        expect(replyProblem({ ...quiet, error: true, errorStatus: 400, errorText: 'OpenAI API error: 400 max_tokens too large' })).toBe(
            'the provider failed (400): OpenAI API error: 400 max_tokens too large'
        );
        expect(replyProblem({ ...quiet, error: true, answered: true })).toBe('the provider failed: the answer stopped before it finished');
    });
});

describe('providerErrorText', () => {
    it('keeps one short line', () => {
        const text = providerErrorText(new Error(`OpenAI API error: 400 {\n  "error": "${'x'.repeat(400)}"\n}`));
        expect(text).not.toContain('\n');
        expect(text.length).toBe(200);
        expect(text.endsWith('…')).toBe(true);
    });

    it('drops a login written into an address', () => {
        expect(providerErrorText(new TypeError('Request cannot be constructed from a URL that includes credentials: https://me:hunter2@llm.example.com/v1'))).toBe(
            'Request cannot be constructed from a URL that includes credentials: https://[redacted]@llm.example.com/v1'
        );
    });

    it('reads a plain string and an empty error', () => {
        expect(providerErrorText('timeout')).toBe('timeout');
        expect(providerErrorText(new Error(''))).toBe('unknown error');
    });
});
