import axios from 'axios';
import type { MatrixAppServiceClient } from './MatrixAppServiceClient';
import type { MatrixEvent, MatrixEventHandler } from './MatrixAppServiceRouter';
import { BOT_LOCALPART_PREFIX, botIdFromMatrixId, type MatrixAppServiceConfig } from './MatrixConfig';
import type { BotConfiguration } from '../server/AdminApiService';
import type { DmAttachment, DmPerson, DmReply, DmReplyHooks } from '../server/DmReplyService';
import type { PendingMedia } from '../memory/ConversationMemory';
import { detectLanguage, statusNoteContent, type BotNoteState, type NoteLanguage } from './BotStatusNotes';

export interface DmAccessResult {
    allowed: boolean;
    reason: string | null;
    user: { uuid: string; name: string | null; isGuest: boolean } | null;
}

/** Orbit could not be asked (down, erroring or not set up), as opposed to saying the person may not chat. */
function accessCheckFailed(result: DmAccessResult): boolean {
    return !result.allowed && (result.reason ?? '').startsWith('admin_api_');
}

export interface MatrixDmBridgeDeps {
    /** `fresh` skips any cache, for checking whether a resting bot is back. */
    getBotConfig(botId: string, fresh?: boolean): Promise<BotConfiguration | null>;
    checkAccess(botId: string, chatId: string): Promise<DmAccessResult>;
    reply(botId: string, person: DmPerson, text: string, attachments: DmAttachment[], hooks: DmReplyHooks): Promise<DmReply | null>;
    /** Optional shared store so the bot still knows its rooms after a restart. */
    rooms?: {
        rememberDmRoom(roomId: string, botId: string): Promise<void>;
        getDmRoomBot(roomId: string): Promise<string | null>;
        forgetDmRoom(roomId: string): Promise<void>;
    };
    /** Upload a file someone sent so the bot can read it like a bubble upload. Returns a URL, or null to skip it. */
    uploadAttachment?(data: Buffer, mimeType: string, filename: string): Promise<string | null>;
    /** One short in-character "not now" from a resting bot, or '' to leave only the plain note. */
    restingLine?(config: BotConfiguration, text: string): Promise<string>;
    /**
     * Optional shared store for messages left with a resting bot. Without it (or while it is down) they wait in this
     * process only.
     */
    waiting?: {
        hasSharedStore(): boolean;
        rememberWaitingDm(botId: string, roomId: string, message: string): Promise<void>;
        waitingDmBots(): Promise<string[]>;
        hasWaitingDms(botId: string): Promise<boolean>;
        takeWaitingDms(botId: string): Promise<string[]>;
    };
}

const ACCESS_CACHE_MS = 60 * 1000;
/** Most person-and-bot pairs whose access is cached; the oldest are dropped first. */
const ACCESS_CACHE_MAX = 5000;
/** A note that repeats (resting, not ready, no access) shows at most this often in one chat. */
const NOTE_REPEAT_MS = 10 * 60 * 1000;
/** A resting bot says its in-character "not now" at most this often in one chat: one short AI call. */
const RESTING_LINE_REPEAT_MS = 6 * 60 * 60 * 1000;
/** Most chats whose last note time is remembered; the oldest are dropped first. */
const NOTE_TIMES_MAX = 5000;
/** A message left with a resting bot is answered when it is back within this long; older ones are dropped. */
const WAITING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** How often bots with waiting messages (only those) are checked for being back. */
const WAITING_CHECK_MS = 5 * 60 * 1000;
const WAITING_BODY_MAX = 4000;
/** A waiting message the bot fails to answer goes back in line this many times before the person is asked to resend it. */
const WAITING_MAX_ATTEMPTS = 3;

/** How many times answering this waiting message has already failed. */
function attemptsOf(event: MatrixEvent): number {
    return Number(event.unsigned?.universe_attempts ?? 0);
}
const TYPING_DELAY_MS = 800;
/** Matrix drops "typing" after its timeout (30 s), so a long answer renews it. */
const TYPING_REFRESH_MS = 20 * 1000;
const MAX_OUTGOING_MEDIA_BYTES = 50 * 1024 * 1024;
const ONLY_DIRECT = 'I only take direct messages.';

/**
 * Turns Matrix events for bot accounts into replies. A bot joins a direct chat when someone allowed to reach its room
 * invites it, answers each message there with DmReplyService, and leaves when the person leaves.
 */
export class MatrixDmBridge implements MatrixEventHandler {
    private roomBots = new Map<string, string>();
    private botNames = new Map<string, string>();
    private accessCache = new Map<string, { result: DmAccessResult; at: number }>();
    /** When each kind of note last went to a chat, keyed `room|state`; and the resting bot's own line, keyed by room. */
    private lastNote = new Map<string, number>();
    private lastRestingLine = new Map<string, number>();
    /** Messages waiting for a resting bot when there is no shared store: bot, then room, then the message. */
    private localWaiting = new Map<string, Map<string, { message: string; at: number }>>();
    private draining = new Set<string>();
    private waitingTimer: NodeJS.Timeout | undefined;
    private handledEvents = new Set<string>();
    /** Joined members per room, kept current from membership events so a reply needs no extra homeserver call. */
    private roomMembers = new Map<string, Set<string>>();
    private handledOrder: string[] = [];
    /** Waits between join attempts when the homeserver refuses or times out. */
    private joinRetryDelaysMs = [1000, 4000];

    constructor(
        private config: MatrixAppServiceConfig,
        private client: MatrixAppServiceClient,
        private deps: MatrixDmBridgeDeps
    ) {}

    /** A resting bot still exists, so people can open a chat with it and hear that it is resting. */
    async userExists(userId: string): Promise<boolean> {
        const botId = botIdFromMatrixId(this.config.domain, userId);
        if (!botId) return false;
        const config = await this.deps.getBotConfig(botId);
        if (!config) return false;
        await this.ensureBotAccount(botId, config.name);
        return true;
    }

    /** Start checking, every few minutes, whether bots with waiting messages are back. Nothing runs for other bots. */
    start(): void {
        if (this.waitingTimer) return;
        this.waitingTimer = setInterval(() => void this.checkWaiting(), WAITING_CHECK_MS);
        this.waitingTimer.unref?.();
    }

    stop(): void {
        clearInterval(this.waitingTimer);
        this.waitingTimer = undefined;
    }

    async onEvent(event: MatrixEvent): Promise<void> {
        if (event.type === 'm.room.member' && typeof event.state_key === 'string') {
            await this.onMembership(event);
            return;
        }
        if (event.type === 'm.room.message') {
            await this.onMessage(event);
        }
    }

    private botUserId(botId: string): string {
        return `@${BOT_LOCALPART_PREFIX}${botId}:${this.config.domain}`;
    }

    private async ensureBotAccount(botId: string, name?: string): Promise<void> {
        await this.client.ensureRegistered(`${BOT_LOCALPART_PREFIX}${botId}`);
        if (name && this.botNames.get(botId) !== name) {
            await this.client.setDisplayName(this.botUserId(botId), name).catch((error) =>
                console.warn(`[MatrixDmBridge] Could not set the display name of bot ${botId}:`, error?.message ?? error)
            );
            this.botNames.set(botId, name);
        }
    }

    /** The bot's name for a note, even once Orbit no longer has it: its Matrix display name is still there. */
    private async botName(botId: string, config?: BotConfiguration | null): Promise<string> {
        if (config?.name) return config.name;
        const known = this.botNames.get(botId);
        if (known) return known;
        const shown = await this.client.getDisplayName(this.botUserId(botId)).catch(() => null);
        return shown || 'This bot';
    }

    /** True when this kind of note already went to this chat recently; otherwise records it as sent now. */
    private recentlySent(times: Map<string, number>, key: string, everyMs: number): boolean {
        const last = times.get(key);
        if (last !== undefined && Date.now() - last < everyMs) return true;
        times.delete(key);
        times.set(key, Date.now());
        if (times.size > NOTE_TIMES_MAX) times.delete(times.keys().next().value!);
        return false;
    }

    private async sendNote(botId: string, roomId: string, state: BotNoteState, language: NoteLanguage, config?: BotConfiguration | null): Promise<void> {
        const content = statusNoteContent(state, language, await this.botName(botId, config));
        await this.client.sendMessage(this.botUserId(botId), roomId, content).catch((error) =>
            console.warn(`[MatrixDmBridge] Could not send a ${state} note in ${roomId}:`, error?.message ?? error)
        );
    }

    private async rememberRoom(roomId: string, botId: string): Promise<void> {
        this.roomBots.set(roomId, botId);
        await this.deps.rooms?.rememberDmRoom(roomId, botId).catch(() => undefined);
    }

    private async forgetRoom(roomId: string): Promise<void> {
        this.roomBots.delete(roomId);
        this.roomMembers.delete(roomId);
        this.lastRestingLine.delete(roomId);
        for (const state of ['resting', 'unready', 'no_access']) this.lastNote.delete(`${roomId}|${state}`);
        await this.deps.rooms?.forgetDmRoom(roomId).catch(() => undefined);
    }

    /** The bot in this DM room, or null for a room it never joined or has left. `strict` throws when the store can't be read. */
    private async botForRoom(roomId: string, strict = false): Promise<string | null> {
        const known = this.roomBots.get(roomId);
        if (known) return known;
        let stored: string | null;
        try {
            stored = (await this.deps.rooms?.getDmRoomBot(roomId)) ?? null;
        } catch (error: any) {
            if (strict) throw error;
            console.warn(`[MatrixDmBridge] Could not look up the bot for ${roomId}:`, error?.message ?? error);
            return null;
        }
        if (stored) this.roomBots.set(roomId, stored);
        return stored;
    }

    private async access(botId: string, chatId: string, fresh = false): Promise<DmAccessResult> {
        const key = `${botId}|${chatId}`;
        const cached = this.accessCache.get(key);
        if (!fresh && cached && Date.now() - cached.at < ACCESS_CACHE_MS) return cached.result;
        const result = await this.deps.checkAccess(botId, chatId);
        // Orbit could not answer, which says nothing about the person, so ask again next time.
        if (accessCheckFailed(result)) return result;
        // Re-insert so the map stays ordered oldest first, then drop the oldest once it is full.
        this.accessCache.delete(key);
        this.accessCache.set(key, { result, at: Date.now() });
        if (this.accessCache.size > ACCESS_CACHE_MAX) {
            this.accessCache.delete(this.accessCache.keys().next().value!);
        }
        return result;
    }

    private async onMembership(event: MatrixEvent): Promise<void> {
        const membership = event.content?.membership;
        const botId = botIdFromMatrixId(this.config.domain, event.state_key!);
        const members = this.roomMembers.get(event.room_id);
        if (members && membership === 'join') members.add(event.state_key!);
        if (members && membership !== 'join' && membership !== 'invite') members.delete(event.state_key!);

        if (botId) {
            if (membership === 'invite') {
                await this.onInvite(event, botId);
            } else if ((membership === 'leave' || membership === 'ban') && (await this.botForRoom(event.room_id)) === botId) {
                // Looked up through the store too, so a leave seen after a restart still clears the room.
                await this.forgetRoom(event.room_id);
            }
            return;
        }

        // The person left the direct chat: the bot leaves too, so nothing lingers on the homeserver.
        if (membership === 'leave' || membership === 'ban') {
            const roomBot = await this.botForRoom(event.room_id);
            if (roomBot) {
                await this.client.leaveRoom(this.botUserId(roomBot), event.room_id).catch(() => undefined);
                await this.forgetRoom(event.room_id);
            }
        }
    }

    private async onInvite(event: MatrixEvent, botId: string): Promise<void> {
        const botUserId = event.state_key!;
        // Area chats and group rooms invite everyone present; a bot only takes one-to-one chats.
        if (event.content?.is_direct !== true) {
            await this.client.leaveRoom(botUserId, event.room_id, ONLY_DIRECT).catch(() => undefined);
            return;
        }
        let config: BotConfiguration | null;
        try {
            config = await this.deps.getBotConfig(botId);
            if (config) await this.ensureBotAccount(botId, config.name);
        } catch (error: any) {
            // Synapse sends the invite only once, so decline it rather than leave the bot invited and silent; the
            // person can invite it again.
            console.warn(`[MatrixDmBridge] Could not take an invite for bot ${botId}:`, error?.message ?? error);
            await this.client.leaveRoom(botUserId, event.room_id).catch(() => undefined);
            return;
        }
        if (!config) {
            await this.client.leaveRoom(botUserId, event.room_id).catch(() => undefined);
            return;
        }
        if (!(await this.joinWithRetry(botUserId, event.room_id))) return;

        // People often type before the bot has joined. Synapse does not push those messages to a bot that was only
        // invited, so read them back and answer the ones that arrived since the invite.
        const missed = await this.client.getRecentMessages(botUserId, event.room_id, 20).catch(() => []);
        const inviteTs = event.origin_server_ts ?? 0;
        const earlier = missed.filter(
            (message) => message.type === 'm.room.message' && message.sender === event.sender && (message.origin_server_ts ?? 0) >= inviteTs
        );

        // Check after joining, so a ban that lands while the join is retried still applies.
        // When Orbit can't be asked right now the bot stays: each message checks again and gets "couldn't answer" until
        // it can, so nothing the person sends is refused or lost.
        const access = await this.access(botId, event.sender, true);
        if (!access.allowed && !accessCheckFailed(access)) {
            const language = detectLanguage(String(earlier[earlier.length - 1]?.content?.body ?? ''));
            await this.sendNote(botId, event.room_id, 'no_access', language, config);
            await this.client.leaveRoom(botUserId, event.room_id).catch(() => undefined);
            return;
        }
        await this.rememberRoom(event.room_id, botId);
        // Messages typed before the join arrive together, so a failure among them gets one "couldn't answer" note.
        const batch = { troubleSent: false };
        for (const message of earlier) {
            await this.onMessage({ ...message, room_id: event.room_id }, batch);
        }
    }

    /**
     * Joins, retrying a brief homeserver failure. Synapse sends the invite only once, so a failed join would leave the
     * bot invited and silent; if every attempt fails the bot declines the invite instead, and the person can invite it
     * again.
     */
    private async joinWithRetry(botUserId: string, roomId: string): Promise<boolean> {
        for (let attempt = 0; ; attempt++) {
            try {
                await this.client.joinRoom(botUserId, roomId);
                return true;
            } catch (error: any) {
                if (attempt >= this.joinRetryDelaysMs.length) {
                    console.error(`[MatrixDmBridge] ${botUserId} could not join ${roomId}:`, error?.message ?? error);
                    await this.client.leaveRoom(botUserId, roomId).catch(() => undefined);
                    return false;
                }
                await new Promise((resolve) => setTimeout(resolve, this.joinRetryDelaysMs[attempt]));
            }
        }
    }

    /** True the first time an event id is seen, so a message read back after joining is never answered twice. */
    private firstSighting(eventId: string): boolean {
        if (this.handledEvents.has(eventId)) return false;
        this.handledEvents.add(eventId);
        this.handledOrder.push(eventId);
        if (this.handledOrder.length > 5000) this.handledEvents.delete(this.handledOrder.shift()!);
        return true;
    }

    private async onMessage(event: MatrixEvent, batch?: { troubleSent: boolean }): Promise<void> {
        // Ignore other bots (ours included), edits and notices.
        if (botIdFromMatrixId(this.config.domain, event.sender)) return;
        const content = event.content ?? {};
        if (content['m.relates_to']?.rel_type === 'm.replace' || content.msgtype === 'm.notice') return;
        if (!this.firstSighting(event.event_id)) return;
        await this.handleMessage(event, false, batch);
    }

    /**
     * Answer one message, or say plainly why the bot can't. `catchUp` is a message a resting bot is answering now that
     * it is back: it gets an answer or nothing, never a second round of notes. If answering it fails, it goes back in
     * line for the next check, and only after the last try is the person told to send it again. Messages in one `batch`
     * share a single "couldn't answer" note.
     */
    private async handleMessage(event: MatrixEvent, catchUp: boolean, batch?: { troubleSent: boolean }): Promise<void> {
        const content = event.content ?? {};
        const botId = await this.botForRoom(event.room_id);
        if (!botId) return;
        const botUserId = this.botUserId(botId);

        const language = detectLanguage(String(content.body ?? ''));
        const couldNotAnswer = async (config?: BotConfiguration) => {
            const attempts = attemptsOf(event) + 1;
            if (catchUp && attempts < WAITING_MAX_ATTEMPTS) {
                await this.rememberWaiting(botId, event, attempts);
                return;
            }
            if (batch?.troubleSent) return;
            if (batch) batch.troubleSent = true;
            await this.sendNote(botId, event.room_id, 'trouble', language, config);
        };

        // Someone added a third person: the room is no longer a one-to-one chat, so the bot stays quiet.
        let members = this.roomMembers.get(event.room_id);
        if (!members) {
            const joined = await this.client.getJoinedMembers(botUserId, event.room_id).catch((error) => {
                console.warn(`[MatrixDmBridge] Could not read the members of ${event.room_id}:`, error?.message ?? error);
                return null;
            });
            if (!joined) {
                await couldNotAnswer();
                return;
            }
            members = new Set(joined);
            this.roomMembers.set(event.room_id, members);
        }
        if (members.size !== 2 || !members.has(event.sender)) {
            // Bots only talk one to one, so a chat that became a group while the bot rested gets no answer.
            if (catchUp) console.info(`[MatrixDmBridge] Dropping a waiting message for bot ${botId}: ${event.room_id} is no longer a direct chat`);
            return;
        }

        let config: BotConfiguration | null;
        try {
            config = await this.deps.getBotConfig(botId, catchUp);
        } catch (error: any) {
            console.warn(`[MatrixDmBridge] Could not load bot ${botId}:`, error?.message ?? error);
            await couldNotAnswer();
            return;
        }
        if (!config) {
            await this.closeChat(botId, event.room_id, language);
            return;
        }

        const access = await this.access(botId, event.sender);
        if (accessCheckFailed(access)) {
            await couldNotAnswer(config);
            return;
        }
        if (!access.allowed || !access.user) {
            if (!catchUp && !this.recentlySent(this.lastNote, `${event.room_id}|no_access`, NOTE_REPEAT_MS)) {
                await this.sendNote(botId, event.room_id, 'no_access', language, config);
            }
            return;
        }
        if (config.enabled === false) {
            // Resting again is not a failed answer, so a message already tried keeps its count.
            await this.rememberWaiting(botId, event, attemptsOf(event));
            if (!catchUp) await this.sayResting(botId, event, config, language);
            return;
        }
        if (!config.aiProviderRef) {
            if (!catchUp && !this.recentlySent(this.lastNote, `${event.room_id}|unready`, NOTE_REPEAT_MS)) {
                await this.sendNote(botId, event.room_id, 'unready', language, config);
            }
            return;
        }

        const { text, attachments, failed } = await this.readMessage(botUserId, content);
        if (!text && attachments.length === 0) {
            // A file with no caption that couldn't be fetched is a failed answer, not an empty message.
            if (failed) await couldNotAnswer(config);
            return;
        }

        const person: DmPerson = {
            matrixUserId: event.sender,
            uuid: access.user.uuid,
            name: access.user.name,
            isGuest: access.user.isGuest,
        };
        // Show "typing" only when the reply takes a moment, like a person would; quick replies need no extra calls.
        let typing = false;
        let typingRefresh: NodeJS.Timeout | undefined;
        const startTyping = () => {
            typing = true;
            void this.client.setTyping(botUserId, event.room_id, true).catch(() => undefined);
            typingRefresh ??= setInterval(
                () => void this.client.setTyping(botUserId, event.room_id, true).catch(() => undefined),
                TYPING_REFRESH_MS
            );
        };
        let typingTimer: NodeJS.Timeout | undefined = setTimeout(startTyping, TYPING_DELAY_MS);
        let answered = false;
        try {
            const reply = await this.deps.reply(botId, person, text, attachments, {
                onInterimMessage: async (interim) => {
                    // A lost "let me look" line must not cost the person the real answer, so it never throws.
                    try {
                        await this.client.sendText(botUserId, event.room_id, interim);
                    } catch (error: any) {
                        console.warn(`[MatrixDmBridge] Could not send an interim message in ${event.room_id}:`, error?.message ?? error);
                    }
                    if (typing) startTyping();
                },
            });
            // No reply at all means the bot couldn't be set up to answer (no AI service here): say so, as for a failure.
            if (!reply || reply.failed) {
                await couldNotAnswer(config);
                return;
            }
            if (reply.text) await this.client.sendText(botUserId, event.room_id, reply.text);
            for (const item of reply.media ?? []) {
                await this.sendMedia(botUserId, event.room_id, item).catch((error) =>
                    console.warn(`[MatrixDmBridge] Could not send media from bot ${botId}:`, error?.message ?? error)
                );
            }
            answered = true;
        } catch (error: any) {
            console.error(`[MatrixDmBridge] Bot ${botId} could not answer in ${event.room_id}:`, error?.message ?? error);
            await couldNotAnswer(config);
        } finally {
            clearTimeout(typingTimer);
            clearInterval(typingRefresh);
            typingTimer = undefined;
            if (typing) await this.client.setTyping(botUserId, event.room_id, false).catch(() => undefined);
        }
        // The bot is answering again, so anyone who wrote while it rested gets their answer now.
        if (answered && !catchUp) void this.drainIfWaiting(botId).catch(() => undefined);
    }

    /** The bot was deleted: one goodbye note, then it leaves so the chat reads as closed. */
    private async closeChat(botId: string, roomId: string, language: NoteLanguage): Promise<void> {
        await this.sendNote(botId, roomId, 'gone', language);
        await this.client.leaveRoom(this.botUserId(botId), roomId).catch(() => undefined);
        await this.forgetRoom(roomId);
    }

    /** A resting bot says "not now" in its own voice now and then, and the plain note says why. */
    private async sayResting(botId: string, event: MatrixEvent, config: BotConfiguration, language: NoteLanguage): Promise<void> {
        const roomId = event.room_id;
        if (this.deps.restingLine && !this.recentlySent(this.lastRestingLine, roomId, RESTING_LINE_REPEAT_MS)) {
            const line = await this.deps.restingLine(config, String(event.content?.body ?? '')).catch(() => '');
            if (line) {
                await this.client.sendText(this.botUserId(botId), roomId, line).catch((error) =>
                    console.warn(`[MatrixDmBridge] Could not send a resting line in ${roomId}:`, error?.message ?? error)
                );
            }
        }
        if (!this.recentlySent(this.lastNote, `${roomId}|resting`, NOTE_REPEAT_MS)) {
            await this.sendNote(botId, roomId, 'resting', language, config);
        }
    }

    /** Keep the latest message in this chat for the bot to answer once it is back on. `attempts` counts failed answers. */
    private async rememberWaiting(botId: string, event: MatrixEvent, attempts = 0): Promise<void> {
        const content = event.content ?? {};
        const kept: Record<string, unknown> = { msgtype: content.msgtype, body: String(content.body ?? '').slice(0, WAITING_BODY_MAX) };
        if (typeof content.url === 'string') kept.url = content.url;
        if (typeof content.filename === 'string') kept.filename = content.filename;
        if (typeof content.info?.mimetype === 'string') kept.info = { mimetype: content.info.mimetype };
        const message = JSON.stringify({
            event_id: event.event_id,
            room_id: event.room_id,
            sender: event.sender,
            origin_server_ts: event.origin_server_ts ?? Date.now(),
            type: 'm.room.message',
            content: kept,
            ...(attempts > 0 ? { unsigned: { universe_attempts: attempts } } : {}),
        });
        if (this.deps.waiting?.hasSharedStore()) {
            try {
                await this.deps.waiting.rememberWaitingDm(botId, event.room_id, message);
                // A copy kept here while the store was down is now older than this one, so only the store's is answered.
                this.dropLocalWaiting(botId, event.room_id);
                return;
            } catch (error: any) {
                // The shared store dropped out: keep the message in this process instead of losing it.
                console.warn(`[MatrixDmBridge] Could not keep a waiting message for bot ${botId} in the shared store:`, error?.message ?? error);
            }
        }
        const rooms = this.localWaiting.get(botId) ?? new Map<string, { message: string; at: number }>();
        rooms.set(event.room_id, { message, at: Date.now() });
        this.localWaiting.set(botId, rooms);
    }

    private dropLocalWaiting(botId: string, roomId: string): void {
        const rooms = this.localWaiting.get(botId);
        rooms?.delete(roomId);
        if (rooms?.size === 0) this.localWaiting.delete(botId);
    }

    private async waitingBots(): Promise<string[]> {
        const shared = this.deps.waiting?.hasSharedStore() ? await this.deps.waiting.waitingDmBots().catch(() => []) : [];
        return [...new Set([...shared, ...this.localWaiting.keys()])];
    }

    /** Every few minutes: bots with waiting messages that are back on answer them. */
    async checkWaiting(): Promise<void> {
        // Messages kept in this process expire like the shared store's, so a bot that stays off holds nothing.
        for (const [botId, rooms] of this.localWaiting) {
            for (const [roomId, kept] of rooms) {
                if (Date.now() - kept.at >= WAITING_MAX_AGE_MS) rooms.delete(roomId);
            }
            if (rooms.size === 0) this.localWaiting.delete(botId);
        }
        for (const botId of await this.waitingBots()) {
            const config = await this.deps.getBotConfig(botId, true).catch(() => undefined);
            if (config === undefined) continue;
            if (config === null) {
                // Deleted: whoever left a message gets the goodbye now, and the bot leaves that chat.
                for (const event of this.readWaiting(await this.takeWaiting(botId))) {
                    if ((await this.botForRoom(event.room_id)) !== botId) continue;
                    await this.closeChat(botId, event.room_id, detectLanguage(String(event.content?.body ?? '')));
                }
            } else if (config.enabled !== false && config.aiProviderRef) {
                await this.drain(botId);
            }
        }
    }

    private async drainIfWaiting(botId: string): Promise<void> {
        const shared = this.deps.waiting?.hasSharedStore() ? await this.deps.waiting.hasWaitingDms(botId).catch(() => false) : false;
        if (shared || this.localWaiting.has(botId)) await this.drain(botId);
    }

    private async takeWaiting(botId: string): Promise<string[]> {
        const local = [...(this.localWaiting.get(botId)?.values() ?? [])].map((kept) => kept.message);
        this.localWaiting.delete(botId);
        const shared = this.deps.waiting?.hasSharedStore() ? await this.deps.waiting.takeWaitingDms(botId).catch(() => []) : [];
        return [...shared, ...local];
    }

    /**
     * Kept messages less than a day old, oldest first, one per chat. A chat can have two when the shared store dropped
     * out after keeping one (a newer one was kept here meanwhile): only the newest is answered, as when nothing failed.
     */
    private readWaiting(messages: string[]): MatrixEvent[] {
        const newestByRoom = new Map<string, MatrixEvent>();
        for (const message of messages) {
            let event: MatrixEvent;
            try {
                event = JSON.parse(message) as MatrixEvent;
            } catch {
                continue;
            }
            if (Date.now() - (event.origin_server_ts ?? 0) >= WAITING_MAX_AGE_MS) continue;
            const kept = newestByRoom.get(event.room_id);
            // Local copies come after the shared store's, so on a tie the later one (written last) wins.
            if (!kept || (event.origin_server_ts ?? 0) >= (kept.origin_server_ts ?? 0)) newestByRoom.set(event.room_id, event);
        }
        return [...newestByRoom.values()].sort((a, b) => (a.origin_server_ts ?? 0) - (b.origin_server_ts ?? 0));
    }

    /** Answer the messages left while the bot rested, oldest first, if they are less than a day old. */
    private async drain(botId: string): Promise<void> {
        if (this.draining.has(botId)) return;
        this.draining.add(botId);
        try {
            const messages = this.readWaiting(await this.takeWaiting(botId));
            for (const event of messages) {
                let roomBot: string | null;
                try {
                    roomBot = await this.botForRoom(event.room_id, true);
                } catch {
                    // The room store is unreachable right now, so the message waits for the next check.
                    await this.rememberWaiting(botId, event, attemptsOf(event));
                    continue;
                }
                if (roomBot !== botId) {
                    // The person left (and the bot with them) or the bot was deleted: nobody is there to answer.
                    console.info(`[MatrixDmBridge] Dropping a waiting message for bot ${botId}: the chat in ${event.room_id} is closed`);
                    continue;
                }
                await this.handleMessage(event, true).catch((error) =>
                    console.warn(`[MatrixDmBridge] Could not answer a waiting message for bot ${botId}:`, error?.message ?? error)
                );
            }
        } finally {
            this.draining.delete(botId);
        }
    }

    /** The message text, plus any file in it re-hosted where the bot can read it. */
    /** `failed` means a file was there but could not be fetched or re-hosted this time. */
    private async readMessage(
        botUserId: string,
        content: Record<string, any>
    ): Promise<{ text: string; attachments: DmAttachment[]; failed?: boolean }> {
        const msgtype = content.msgtype;
        if (msgtype === 'm.text' || msgtype === 'm.emote') {
            return { text: String(content.body ?? '').trim(), attachments: [] };
        }
        const mediaType = ({ 'm.image': 'image', 'm.file': 'file', 'm.audio': 'audio', 'm.video': 'video' } as const)[
            msgtype as 'm.image' | 'm.file' | 'm.audio' | 'm.video'
        ];
        if (!mediaType || typeof content.url !== 'string' || !this.deps.uploadAttachment) {
            return { text: '', attachments: [] };
        }
        // A caption is carried in body when filename is set separately (Matrix v1.10).
        const filename = String(content.filename ?? content.body ?? 'file');
        const caption = content.filename && content.body && content.body !== content.filename ? String(content.body) : '';
        try {
            const file = await this.client.downloadMedia(botUserId, content.url);
            const mimeType = String(content.info?.mimetype ?? file.contentType);
            const url = await this.deps.uploadAttachment(file.data, mimeType, filename);
            if (!url) return { text: caption, attachments: [] };
            return { text: caption, attachments: [{ url, mimeType, mediaType }] };
        } catch (error) {
            console.warn('[MatrixDmBridge] Could not read an attachment:', (error as Error)?.message ?? error);
            return { text: caption, attachments: [], failed: true };
        }
    }

    private async sendMedia(botUserId: string, roomId: string, item: PendingMedia): Promise<void> {
        const { FileParser } = await import('../services/FileParser');
        await FileParser.validateUrl(item.url);
        const response = await axios.get(item.url, {
            responseType: 'arraybuffer',
            timeout: 60000,
            maxRedirects: 0,
            maxContentLength: MAX_OUTGOING_MEDIA_BYTES,
        });
        const data = Buffer.from(response.data);
        const mimeType = item.mimeType || String(response.headers['content-type'] || 'application/octet-stream');
        const filename = new URL(item.url).pathname.split('/').pop() || `${item.mediaType}`;
        const mxc = await this.client.uploadMedia(botUserId, data, mimeType, filename);
        const msgtype = { image: 'm.image', audio: 'm.audio', video: 'm.video', file: 'm.file' }[item.mediaType] ?? 'm.file';
        await this.client.sendMessage(botUserId, roomId, {
            msgtype,
            body: item.caption || filename,
            filename,
            url: mxc,
            info: { mimetype: mimeType, size: data.length },
        });
    }
}
