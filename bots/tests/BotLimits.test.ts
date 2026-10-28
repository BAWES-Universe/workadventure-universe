import { describe, expect, it } from 'vitest';
import { BOT_LIMIT_DEFAULTS, readBotLimits } from '../ai/types';

describe('a bot limits from Orbit (Orbit #666)', () => {
    it('takes each limit Orbit sent', () => {
        expect(readBotLimits({ steps: 12, readChars: 20000, artifactSaveSeconds: 45, guard: false })).toEqual({
            ...BOT_LIMIT_DEFAULTS,
            steps: 12,
            readChars: 20000,
            artifactSaveSeconds: 45,
            guard: false,
        });
    });

    it('takes 0 only where 0 means something: keep every version, never carry on, no media in a save (CodeRabbit on the R6 release)', () => {
        expect(readBotLimits({ artifactVersions: 0, continuations: 0, artifactMediaBytes: 0 })).toEqual({ ...BOT_LIMIT_DEFAULTS, artifactVersions: 0, continuations: 0, artifactMediaBytes: 0 });
        // A save with no time limit, a reply of 0 tokens: broken, so the recommended value
        expect(readBotLimits({ artifactSaveSeconds: 0, readChars: 0, replyTokens: 0, waitSeconds: 0 })).toEqual(BOT_LIMIT_DEFAULTS);
    });

    it('keeps the recommended value for anything missing or broken', () => {
        expect(readBotLimits(null)).toEqual(BOT_LIMIT_DEFAULTS);
        expect(readBotLimits({ steps: -1, messages: Number.NaN, readChars: '9' })).toEqual(BOT_LIMIT_DEFAULTS);
    });
});
