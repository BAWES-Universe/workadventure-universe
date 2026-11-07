/**
 * Puts "Hear this voice say hello" (see VoiceHello) together out of the bot server's own parts: Orbit for what the bot speaks with and
 * the person's allowance; the voice worker for the audio. Kept apart from
 * VoiceHello so that file can be tested with plain stand-ins.
 */
import { randomUUID } from 'crypto';
import type { AdminApiService } from '../server/AdminApiService';
import { HelloCache, VoiceHello, previewAtWorker, workerPreviewUrl } from './VoiceHello';
import { BotVoiceSettings } from './VoiceSettings';
import { voiceHelloCacheSettings, voiceOrbitSettings, voiceWorkerSettings } from './settings';

/** Null where hello can't work: no Orbit set up for voice (the bot server then answers "not available"). */
export function buildVoiceHello(admin: AdminApiService, env: NodeJS.ProcessEnv = process.env): VoiceHello | null {
    if (!admin.isConfigured() || !env.BOT_SERVICE_TOKEN) return null;
    const worker = voiceWorkerSettings(env);
    let previewUrl: string;
    try {
        previewUrl = workerPreviewUrl(worker.url);
    } catch {
        return null;
    }
    const log = (message: string) => console.warn(`[VoiceHello] ${message}`);
    return new VoiceHello({
        // No reuse of an earlier answer: a voice picked a moment ago is the one heard
        voice: (botId) => new BotVoiceSettings(botId, admin, { ...voiceOrbitSettings(env), activeCacheMs: 0 }, log),
        allowance: admin,
        preview: (request, timeoutMs) => previewAtWorker(previewUrl, worker.secret, request, timeoutMs),
        newId: () => randomUUID(),
        log,
        // The same line with the same voice, model, style and language is played again for a while instead of being paid for again
        cache: new HelloCache(voiceHelloCacheSettings(env)),
    });
}
