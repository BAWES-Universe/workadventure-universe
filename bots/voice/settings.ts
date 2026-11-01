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
    /** How long a greeting finished before anyone's audio connected waits for it, in seconds. Past it, it is not said. */
    greetingWaitSeconds: number;
}

export const DEFAULT_REPLY_LIMITS: ReplyLimits = { maxChars: 600, maxSeconds: 60, greetingWaitSeconds: 15 };

export function voiceReplyLimits(env: NodeJS.ProcessEnv = process.env): ReplyLimits {
    const positive = (value: string | undefined, fallback: number): number => {
        const parsed = Number.parseInt(value ?? '', 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };
    return {
        maxChars: positive(env.VOICE_REPLY_MAX_CHARS, DEFAULT_REPLY_LIMITS.maxChars),
        maxSeconds: positive(env.VOICE_REPLY_MAX_SECONDS, DEFAULT_REPLY_LIMITS.maxSeconds),
        greetingWaitSeconds: positive(env.VOICE_GREETING_WAIT_SECONDS, DEFAULT_REPLY_LIMITS.greetingWaitSeconds),
    };
}

/** How the bot server talks to Orbit about a bot's voice. Ordinary settings: they do not switch voice on or off. */
export interface VoiceOrbitSettings {
    /** How long one Orbit call may take before the bot answers in text instead, in milliseconds. */
    timeoutMs: number;
    /** How long Orbit's answer to "does this bot speak now" is reused, in milliseconds. 0 asks every time. */
    activeCacheMs: number;
    /** How long the server's voice limits are reused when Orbit's answer for a bot carries none, in milliseconds. */
    limitsCacheMs: number;
}

export const DEFAULT_VOICE_ORBIT_SETTINGS: VoiceOrbitSettings = { timeoutMs: 5000, activeCacheMs: 3000, limitsCacheMs: 60000 };

export function voiceOrbitSettings(env: NodeJS.ProcessEnv = process.env): VoiceOrbitSettings {
    const seconds = (value: string | undefined, fallbackMs: number, allowZero: boolean): number => {
        const parsed = Number.parseFloat(value ?? '');
        if (!Number.isFinite(parsed) || parsed < 0 || (parsed === 0 && !allowZero)) return fallbackMs;
        return Math.round(parsed * 1000);
    };
    return {
        timeoutMs: seconds(env.VOICE_ORBIT_TIMEOUT_SECONDS, DEFAULT_VOICE_ORBIT_SETTINGS.timeoutMs, false),
        activeCacheMs: seconds(env.VOICE_ACTIVE_CACHE_SECONDS, DEFAULT_VOICE_ORBIT_SETTINGS.activeCacheMs, true),
        limitsCacheMs: seconds(env.VOICE_LIMITS_CACHE_SECONDS, DEFAULT_VOICE_ORBIT_SETTINGS.limitsCacheMs, true),
    };
}
