import { afterEach, describe, expect, it } from 'vitest';
import { fittedMaxTokens, forgetTokenCeilings, rememberTokenCeiling, statedTokenCeiling } from '../ai/providers/tokenCeiling';

describe('the most tokens a model takes, as its provider says (Orbit #666)', () => {
    afterEach(() => forgetTokenCeilings());

    it('reads the number from the ways providers say it', () => {
        expect(statedTokenCeiling(400, '{"error":{"message":"max_tokens is too large: 32000. This model supports at most 16384 completion tokens, whereas you provided 32000."}}', 32000)).toEqual({ tokens: 16384, fixed: true });
        expect(statedTokenCeiling(400, 'Invalid max_tokens value, the valid range of max_tokens is [1, 8192]', 32000)).toEqual({ tokens: 8192, fixed: true });
        expect(statedTokenCeiling(400, 'max_tokens: 64001 > 64000, which is the maximum allowed number of output tokens for claude-x', 64001)).toEqual({ tokens: 64000, fixed: true });
        expect(statedTokenCeiling(400, '`max_tokens` must be less than or equal to `8192`, the maximum value for `max_tokens` is less than the `context_window` for this model', 32000)).toEqual({ tokens: 8192, fixed: true });
    });

    it('takes what the context leaves after the prompt, without keeping it for the model', () => {
        expect(statedTokenCeiling(400, "This model's maximum context length is 8192 tokens. However, you requested 32500 tokens (500 in the messages, 32000 in the completion).", 32000)).toEqual({ tokens: 8192 - 500 - 64, fixed: false });
    });

    it('says nothing for another error, another status, or a number that is not lower', () => {
        expect(statedTokenCeiling(401, 'supports at most 16384 completion tokens', 32000)).toBeNull();
        expect(statedTokenCeiling(400, 'Invalid API key', 32000)).toBeNull();
        expect(statedTokenCeiling(400, 'supports at most 64000 completion tokens', 32000)).toBeNull();
    });

    it('asks a model for no more than its provider said it takes, per address and model', () => {
        expect(fittedMaxTokens('https://api.openai.com/v1', 'gpt-4o', 32000)).toBe(32000);
        rememberTokenCeiling('https://api.openai.com/v1', 'gpt-4o', 16384);
        expect(fittedMaxTokens('https://api.openai.com/v1', 'gpt-4o', 32000)).toBe(16384);
        expect(fittedMaxTokens('https://api.openai.com/v1', 'gpt-4o', 8000)).toBe(8000);
        expect(fittedMaxTokens('https://api.openai.com/v1', 'gpt-5', 32000)).toBe(32000);
    });
});
