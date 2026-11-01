/** Where the voice worker is, and the secret the bot server presents to it. Ordinary settings: they do not switch voice on or off. */
export function voiceWorkerSettings(env: NodeJS.ProcessEnv = process.env): { url: string; secret?: string } {
    return {
        url: env.VOICE_WORKER_URL || 'ws://127.0.0.1:8830',
        secret: env.VOICE_WORKER_SECRET || undefined,
    };
}
