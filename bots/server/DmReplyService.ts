/**
 * Answers a direct message to a bot the same way the bot answers in a bubble on the map: same personality, memory,
 * emotions, tools (minus the map ones), repetition checks and conversation log. The bot does not need to be spawned.
 *
 * It reuses BaseBehavior's helpers (attachment parsing, vision images, regenerate-on-repetition) by extending it with
 * no BotClient attached, so the bubble path itself is untouched. One instance serves every bot in the process.
 */
import { BaseBehavior } from '../behaviors/BaseBehavior';
import { parseEmotionsFromResponse, appendStreamedChunk } from '../ai/EmotionParser';
import type { PendingMedia } from '../memory/ConversationMemory';
import type { BotConfiguration } from './AdminApiService';
import type { BotManager } from './BotManager';

/** Label stored with direct messages in memory and analytics, where bubble messages store their space name. */
export const DM_SPACE_NAME = 'matrix-dm';
const DEFAULT_INSTRUCTIONS = 'You are a helpful bot.';
/** A direct message after this long counts as a new conversation, like walking up to the bot again. */
const NEW_CONVERSATION_AFTER_MS = 30 * 60 * 1000;
const CONFIG_CACHE_MS = 60 * 1000;
const MAX_TRACKED_PEOPLE = 10000;
const MAX_CACHED_CONFIGS = 1000;

export interface DmPerson {
    /** Matrix ID of the sender, e.g. @alice:matrix.bawes.net */
    matrixUserId: string;
    /** WorkAdventure uuid from Orbit, so the bot remembers them from the map too */
    uuid: string;
    name: string | null;
    isGuest: boolean;
}

export interface DmAttachment {
    url: string;
    mimeType: string;
    mediaType?: 'image' | 'file' | 'audio' | 'video';
}

export interface DmReplyHooks {
    /** Text the bot says before it runs a tool ("Let me look that up"), sent as its own message like a bubble. */
    onInterimMessage?: (text: string) => Promise<void>;
}

export interface DmReply {
    text: string;
    /** Media the bot's tools produced, to send after the text. */
    media: PendingMedia[];
    /** The AI provider failed on this message, so there is no answer; the person can send it again. */
    failed?: boolean;
}

/** How a resting bot words "not now", so it still sounds like itself. */
const RESTING_PROMPT =
    "Right now you are switched off for a while and can't chat. Answer the person's message with one short sentence, " +
    "in character and in the same language they wrote in, saying you can't talk right now and they can come back later. " +
    "Don't answer their question, and don't mention AI, settings or anyone who runs you.";

export class DmReplyService extends BaseBehavior {
    private queues = new Map<string, Promise<unknown>>();
    private playerIds = new Map<string, number>();
    private nextPlayerId = -1;
    private loadedBots = new Set<string>();
    private configCache = new Map<string, { config: BotConfiguration | null; at: number }>();

    constructor(private botManager: BotManager) {
        super({ type: 'dm' });
        this.setServices(
            botManager.getAIService(),
            botManager.getAdminApiService(),
            botManager.getConversationStorage(),
            botManager.getResponseProcessor(),
            botManager.getMetricsCollector()
        );
        this.setConversationMemory(botManager.getConversationMemory());
    }

    // A DM has no map to move on and streams nothing, so the per-frame and bubble-streaming hooks do nothing.
    update(): void {}
    protected async generateAIResponseStream(): Promise<void> {}

    /**
     * Reply to one direct message. Messages from the same person to the same bot are answered in order.
     * Returns null when the bot has no AI provider (it stays silent, as it does in a bubble).
     */
    reply(botId: string, person: DmPerson, text: string, attachments: DmAttachment[] = [], hooks: DmReplyHooks = {}): Promise<DmReply | null> {
        const key = `${botId}|${person.matrixUserId}`;
        const previous = this.queues.get(key) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(() => this.replyNow(botId, person, text, attachments, hooks));
        this.queues.set(key, next);
        void next.finally(() => {
            if (this.queues.get(key) === next) this.queues.delete(key);
        }).catch(() => undefined);
        return next;
    }

    /** A stable negative player id per Matrix user. Map players have positive ids and tests use 999999. */
    playerIdFor(matrixUserId: string): number {
        let id = this.playerIds.get(matrixUserId);
        if (id === undefined) id = this.nextPlayerId--;
        // Keep the map ordered by last use and drop the least recent once it is full. Someone dropped gets a new id
        // next time, like a player rejoining a map; their memory follows their uuid, so nothing is lost.
        this.playerIds.delete(matrixUserId);
        this.playerIds.set(matrixUserId, id);
        if (this.playerIds.size > MAX_TRACKED_PEOPLE) this.playerIds.delete(this.playerIds.keys().next().value!);
        return id;
    }

    /**
     * The bot's configuration: the live one when it is spawned, else Orbit's (cached briefly). `fresh` skips the cache,
     * for checking whether a resting bot is back.
     */
    async getBotConfig(botId: string, fresh = false): Promise<BotConfiguration | null> {
        const live = this.botManager.getBot(botId)?.getFullConfig();
        if (live) return live;
        const cached = this.configCache.get(botId);
        if (!fresh && cached && Date.now() - cached.at < CONFIG_CACHE_MS) return cached.config;
        const config = await this.botManager.getAdminApiService().getBotConfiguration(botId);
        this.configCache.delete(botId);
        this.configCache.set(botId, { config, at: Date.now() });
        if (this.configCache.size > MAX_CACHED_CONFIGS) this.configCache.delete(this.configCache.keys().next().value!);
        return config;
    }

    /**
     * One short in-character line from a resting bot, in the language of the person's message. Empty when the bot has
     * no AI provider or the provider fails; the plain note explains it either way. Not kept in memory.
     */
    async restingLine(config: BotConfiguration, text: string): Promise<string> {
        if (!config.aiProviderRef || !this.aiService || !text.trim()) return '';
        const instructions = `${config.chatInstructions || DEFAULT_INSTRUCTIONS}\n\n${RESTING_PROMPT}`;
        try {
            const line = await this.aiService.quickGenerate(config.aiProviderRef, instructions, text.slice(0, 500));
            return parseEmotionsFromResponse(line).cleanedResponse.trim().slice(0, 300);
        } catch (error) {
            console.warn(`[DmReplyService] Resting line failed for bot ${config.botId}:`, (error as Error)?.message ?? error);
            return '';
        }
    }

    private async ensureMemoriesLoaded(botId: string): Promise<void> {
        if (this.loadedBots.has(botId) || this.botManager.getBot(botId)) return;
        const memory = this.conversationMemory as unknown as { loadMemories?: (botId: string) => Promise<void> };
        if (typeof memory?.loadMemories === 'function') {
            try {
                await memory.loadMemories(botId);
            } catch (error) {
                console.warn(`[DmReplyService] Could not load memories for bot ${botId}:`, error);
                return;
            }
        }
        this.loadedBots.add(botId);
    }

    private async replyNow(botId: string, person: DmPerson, text: string, attachments: DmAttachment[], hooks: DmReplyHooks): Promise<DmReply | null> {
        const config = await this.getBotConfig(botId);
        if (!config?.aiProviderRef || !this.aiService || !this.conversationMemory) return null;
        const chatInstructions = config.chatInstructions || DEFAULT_INSTRUCTIONS;
        const playerId = this.playerIdFor(person.matrixUserId);
        const memory = this.conversationMemory;

        await this.ensureMemoriesLoaded(botId);
        const withUuid = memory as unknown as { setUserUuid?: (b: string, p: number, u: string, l: boolean) => void };
        withUuid.setUserUuid?.(botId, playerId, person.uuid, !person.isGuest);

        // Same attachment handling as a bubble: parsed text for the model, image URLs for vision.
        let augmented = text;
        let images: string[] = [];
        const [primary, ...gallery] = attachments;
        if (primary) {
            const galleryUrls = gallery.map((a) => a.url);
            augmented = await this.formatParsedAttachment(text, primary.url, primary.mimeType, primary.mediaType, galleryUrls);
            images = await this.collectImageUrls(primary.url, primary.mediaType, primary.mimeType, galleryUrls);
        }
        const original = text || (primary ? `[sent a ${primary.mediaType || 'file'}]` : '');

        const lastMet = memory.getMemory(botId, playerId)?.relationship?.lastMet ?? 0;
        if (Date.now() - lastMet > NEW_CONVERSATION_AFTER_MS) {
            memory.startConversation(botId, playerId);
        }
        memory.addMessage(botId, playerId, original, 'person', DM_SPACE_NAME);
        memory.extractPersonalInfo(botId, playerId, original);
        if (this.conversationStorage) {
            this.conversationStorage.startConversation(botId, person.uuid, {
                name: person.name ?? undefined,
                uuid: person.uuid,
                isLogged: !person.isGuest,
            });
            this.conversationStorage.addMessage(botId, person.uuid, original, 'person').catch((error) =>
                console.error('[DmReplyService] Could not log the message:', error)
            );
        }

        const context = memory.getConversationContext(botId, playerId);
        const startTime = Date.now();
        let fullMessage = '';
        let tokensUsed = 0;
        let latency = 0;
        let promptTokens = 0;
        let completionTokens = 0;

        try {
            for await (const chunk of this.aiService.generateBotResponseStream(
                botId,
                playerId,
                augmented,
                chatInstructions,
                config.aiProviderRef,
                DM_SPACE_NAME,
                context,
                undefined,
                this.adminApiService ?? undefined,
                undefined,
                images.length ? images : undefined,
                'dm'
            )) {
                if (chunk.reset) {
                    // The model said something before calling tools: in a bubble that stays as its own bubble.
                    const interim = parseEmotionsFromResponse(fullMessage).cleanedResponse.trim();
                    if (interim) await hooks.onInterimMessage?.(interim);
                    if (process.env.ENABLE_BOT_DEBUG === 'true') {
                        for (const toolName of chunk.toolNames ?? []) {
                            await hooks.onInterimMessage?.(`🔍 ${toolName}...`);
                        }
                    }
                    fullMessage = '';
                    continue;
                }
                if (chunk.content) fullMessage = appendStreamedChunk(fullMessage, chunk.content);
                if (chunk.metadata?.tokensUsed) tokensUsed = chunk.metadata.tokensUsed;
                if (chunk.metadata?.latency) latency = chunk.metadata.latency;
                if (chunk.metadata?.promptTokens) promptTokens = chunk.metadata.promptTokens;
                if (chunk.metadata?.completionTokens) completionTokens = chunk.metadata.completionTokens;
                if (chunk.done) break;
            }
        } catch (error) {
            console.error(`[DmReplyService] AI error for bot ${botId}:`, error);
            return { text: '', media: [], failed: true };
        }

        const responseTime = latency || Date.now() - startTime;
        const parsed = parseEmotionsFromResponse(fullMessage);
        let replyText = parsed.cleanedResponse;
        memory.updateEmotionsFromAI(
            botId,
            playerId,
            parsed.emotions ?? { personSentiment: 0, isInsult: false, insultSeverity: 0, context: 'neutral' }
        );

        if (this.responseProcessor && replyText.trim()) {
            const tokenUsage = tokensUsed > 0
                ? {
                      prompt: promptTokens || Math.floor(tokensUsed * 0.7),
                      completion: completionTokens || Math.floor(tokensUsed * 0.3),
                      total: tokensUsed,
                  }
                : undefined;
            const processed = this.responseProcessor.processResponse(botId, playerId, replyText, chatInstructions, responseTime, tokenUsage);
            const regenerated = await this.regenerateOnRepetition({
                botId,
                playerId,
                playerMessage: augmented,
                chatInstructions,
                aiProviderRef: config.aiProviderRef,
                spaceName: DM_SPACE_NAME,
                context,
                processed,
                processedMessage: processed.cleaned,
                fullMessage,
                responseTime,
                tokenUsage,
                responseId: `dm-${botId}-${playerId}`,
                debugLabel: 'DmReplyService',
                images: images.length ? images : undefined,
                channel: 'dm',
            });
            replyText = regenerated.processedMessage;
        }

        replyText = replyText.trim();
        if (replyText) {
            memory.addMessage(botId, playerId, replyText, 'bot', DM_SPACE_NAME);
            this.conversationStorage?.addMessage(botId, person.uuid, replyText, 'bot').catch((error) =>
                console.error('[DmReplyService] Could not log the reply:', error)
            );
        }

        // Media the tools produced waits in memory; a DM delivers it as attachments right after the text.
        const playerMemory = memory.getMemory(botId, playerId);
        const media = playerMemory?.pendingMedia?.splice(0) ?? [];
        return { text: replyText, media };
    }
}
