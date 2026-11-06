/**
 * Puts "Hear <bot> say hello" (see VoiceHello) together out of the bot server's own parts: Orbit for what the bot speaks with, the
 * person's allowance and the bot's saved settings; the bot's own AI for the words; the voice worker for the audio. Kept apart from
 * VoiceHello so that file can be tested with plain stand-ins.
 */
import { randomUUID } from 'crypto';
import type { AIService } from '../ai/AIService';
import type { AdminApiService } from '../server/AdminApiService';
import { VoiceHello, previewAtWorker, workerPreviewUrl } from './VoiceHello';
import { BotVoiceSettings } from './VoiceSettings';
import { voiceOrbitSettings, voiceWorkerSettings } from './settings';

/** Null where hello can't work: no Orbit set up for voice (the bot server then answers "not available"). */
export function buildVoiceHello(admin: AdminApiService, ai: AIService, env: NodeJS.ProcessEnv = process.env): VoiceHello | null {
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
        bot: async (botId) => {
            const config = await admin.getBotConfiguration(botId, 5000);
            return config ? { name: config.name, chatInstructions: config.chatInstructions || undefined, aiProviderRef: config.aiProviderRef || undefined } : null;
        },
        write: (ref, system, user, botId, timeoutMs) => ai.quickGenerate(ref, system, user, botId, timeoutMs),
        preview: (request, timeoutMs) => previewAtWorker(previewUrl, worker.secret, request, timeoutMs),
        newId: () => randomUUID(),
        log,
    });
}
