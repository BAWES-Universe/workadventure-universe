/** Where the voice worker is, and the secret the bot server presents to it. Ordinary settings: they do not switch voice on or off. */
export function voiceWorkerSettings(env: NodeJS.ProcessEnv = process.env): { url: string; secret?: string } {
    return {
        url: env.VOICE_WORKER_URL || 'ws://127.0.0.1:8830',
        secret: env.VOICE_WORKER_SECRET || undefined,
    };
}

/** The limits on what a voice bot says out loud in one reply. Ordinary settings; Orbit supplies them per bot later. */
export interface ReplyLimits {
    /** Characters of speech. The chat always has the reply in full. */
    maxChars: number;
    /** Seconds of speech. */
    maxSeconds: number;
}

export const DEFAULT_REPLY_LIMITS: ReplyLimits = { maxChars: 600, maxSeconds: 60 };

export function voiceReplyLimits(env: NodeJS.ProcessEnv = process.env): ReplyLimits {
    const positive = (value: string | undefined, fallback: number): number => {
        const parsed = Number.parseInt(value ?? '', 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };
    return {
        maxChars: positive(env.VOICE_REPLY_MAX_CHARS, DEFAULT_REPLY_LIMITS.maxChars),
        maxSeconds: positive(env.VOICE_REPLY_MAX_SECONDS, DEFAULT_REPLY_LIMITS.maxSeconds),
    };
}
