import axios from 'axios';
import type { MatrixAppServiceClient } from './MatrixAppServiceClient';
import type { MatrixEvent, MatrixEventHandler } from './MatrixAppServiceRouter';
import { BOT_LOCALPART_PREFIX, botIdFromMatrixId, type MatrixAppServiceConfig } from './MatrixConfig';
import type { BotConfiguration } from '../server/AdminApiService';
import type { DmAttachment, DmPerson, DmReply, DmReplyHooks } from '../server/DmReplyService';
import type { PendingMedia } from '../memory/ConversationMemory';
import {
    availabilityOf,
    detectLanguage,
    replyLimitContent,
    statusNoteContent,
    type BotAvailability,
    type BotNoteState,
    type NoteLanguage,
} from './BotStatusNotes';
import { ACCESS_CACHE_TTL_MS } from '../server/BotAccessGate';
import { BotWokaAvatar } from './BotWokaAvatar';
import { ARTIFACT_KEY, artifactDirectMessage } from '../ai/ArtifactTools';
import { STEPS_KEY, type StepsField } from '../ai/ToolSteps';

/** The field of a reply that names the bot's room: the game shows a card under it to go there. */
export const ROOM_LINK_KEY = 'universe.room_link';

export interface DmAccessResult {
    allowed: boolean;
    reason: string | null;
    user: { uuid: string; name: string | null; isGuest: boolean } | null;
}

/** Orbit could not be asked (down, erroring or not set up), as opposed to saying the person may not chat. */
function accessCheckFailed(result: DmAccessResult): boolean {
    return !result.allowed && (result.reason ?? '').startsWith('admin_api_');
}

/** The note for a refusal: the owner's own limit, or not being able to reach the bot at all. */
function refusalNote(result: DmAccessResult): 'limited' | 'no_access' {
    return result.reason === 'not_allowed' ? 'limited' : 'no_access';
}

/** Orbit says this person may chat with the bot, and who they are. Nothing else lets the bot join or answer. */
function mayChat(result: DmAccessResult): boolean {
    return result.allowed && result.user !== null;
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
    /** The bot's Woka as a PNG for its chat picture, or null when it has none. Without it bots keep no picture. */
    wokaPicture?(config: BotConfiguration): Promise<Buffer | null>;
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

/** As long as nearby chat keeps an answer, so an owner's change reaches a DM in the same time. */
const ACCESS_CACHE_MS = ACCESS_CACHE_TTL_MS;
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
/**
 * Orbit must say "no such bot" this many times, each at least BOT_GONE_SPACING_MS after the last, before a chat is
 * closed as deleted: its proxy can answer "not found" for a while when Orbit restarts. The bot server's other "gone"
 * rule (the privacy setting) waits for the same count.
 */
const BOT_GONE_AFTER = 3;
/** As long as a bot's settings are cached, so each count is a fresh answer from Orbit. */
const BOT_GONE_SPACING_MS = 60 * 1000;

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
    /** Messages a drain has taken but not started on yet, per bot: on shutdown they go back in line. */
    private drainQueues = new Map<string, MatrixEvent[]>();
    /** Drains running now, per bot: on shutdown the message each is answering gets time to land. */
    private drains = new Map<string, Promise<void>>();
    private stopping = false;
    private waitingTimer: NodeJS.Timeout | undefined;
    private handledEvents = new Set<string>();
    /** Joined members per room, kept current from membership events so a reply needs no extra homeserver call. */
    private roomMembers = new Map<string, Set<string>>();
    /** Bots Orbit last said don't exist: how many times in a row, and when that was last counted. */
    private botNotFound = new Map<string, { inARow: number; at: number }>();
    /** When each chat last got a live answer: a message left there while the bot rested, older than that, is passed. */
    private answeredLive = new Map<string, number>();
    /** Chats with a live answer on its way, and when that message was sent: an older waiting one holds until it lands. */
    private answeringLive = new Map<string, number>();
    private handledOrder: string[] = [];
    /** Waits between join attempts when the homeserver refuses or times out. */
    private joinRetryDelaysMs = [1000, 4000];

    constructor(
        private config: MatrixAppServiceConfig,
        private client: MatrixAppServiceClient,
        private deps: MatrixDmBridgeDeps
    ) {
        const draw = deps.wokaPicture;
        this.avatars = draw ? new BotWokaAvatar(client, (botConfig) => draw(botConfig)) : undefined;
    }

    /** Keeps each bot's chat picture its Woka, for chat apps outside the game (Element). */
    private avatars?: BotWokaAvatar;

    /** A resting bot still exists, so a chat can be started with it; it declines that invite and the game shows it as resting. */
    async userExists(userId: string): Promise<boolean> {
        const botId = botIdFromMatrixId(this.config.domain, userId);
        if (!botId) return false;
        const config = await this.deps.getBotConfig(botId);
        if (!config) return false;
        await this.ensureBotAccount(botId, config);
        return true;
    }

    /** Start checking, every few minutes, whether bots with waiting messages are back. Nothing runs for other bots. */
    start(): void {
        if (this.waitingTimer) return;
        this.waitingTimer = setInterval(() => void this.checkWaiting(), WAITING_CHECK_MS);
        this.waitingTimer.unref?.();
    }

    /**
     * Stop checking, put back in line any waiting message a drain took but hasn't started on, and give the ones being
     * answered up to `timeoutMs` to land. False when some were still being answered at the end of that time.
     */
    async stop(timeoutMs = 0): Promise<boolean> {
        this.stopping = true;
        clearInterval(this.waitingTimer);
        this.waitingTimer = undefined;
        for (const [botId, queue] of this.drainQueues) {
            for (const event of queue.splice(0)) await this.rememberWaiting(botId, event, attemptsOf(event));
        }
        this.drainQueues.clear();
        if (this.drains.size === 0) return true;
        let timer: NodeJS.Timeout | undefined;
        const landed = await Promise.race([
            Promise.all([...this.drains.values()]).then(() => true),
            new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), timeoutMs))),
        ]);
        clearTimeout(timer);
        return landed;
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

    private async ensureBotAccount(botId: string, config: BotConfiguration): Promise<void> {
        await this.client.ensureRegistered(`${BOT_LOCALPART_PREFIX}${botId}`);
        // In the background: the picture never holds up an answer, and a failure is tried again next time.
        void this.avatars?.update(this.botUserId(botId), config);
        const name = config.name;
        if (name && this.botNames.get(botId) !== name) {
            // Only a name that got through is remembered, so a failed one is tried again next time.
            await this.client.setDisplayName(this.botUserId(botId), name).then(
                () => this.botNames.set(botId, name),
                (error) => console.warn(`[MatrixDmBridge] Could not set the display name of bot ${botId}:`, error?.message ?? error)
            );
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

    /** Returns whether the note reached the chat. */
    private async sendNote(botId: string, roomId: string, state: BotNoteState, language: NoteLanguage, config?: BotConfiguration | null): Promise<boolean> {
        const content = statusNoteContent(state, language, await this.botName(botId, config));
        return this.client.sendMessage(this.botUserId(botId), roomId, content).then(
            () => true,
            (error) => {
                console.warn(`[MatrixDmBridge] Could not send a ${state} note in ${roomId}:`, error?.message ?? error);
                return false;
            }
        );
    }

    /** A note that repeats at most every few minutes per chat. Only a note that reached the chat starts the wait. */
    private async sendNoteNowAndThen(botId: string, roomId: string, state: BotNoteState, language: NoteLanguage, config: BotConfiguration): Promise<void> {
        const key = `${roomId}|${state}`;
        if (this.recentlySent(this.lastNote, key, NOTE_REPEAT_MS)) return;
        if (!(await this.sendNote(botId, roomId, state, language, config))) this.lastNote.delete(key);
    }

    private async rememberRoom(roomId: string, botId: string): Promise<void> {
        this.roomBots.set(roomId, botId);
        await this.deps.rooms?.rememberDmRoom(roomId, botId).catch(() => undefined);
    }

    private async forgetRoom(roomId: string): Promise<void> {
        this.roomBots.delete(roomId);
        this.roomMembers.delete(roomId);
        this.lastRestingLine.delete(roomId);
        for (const state of ['resting', 'unready', 'no_access', 'limited']) this.lastNote.delete(`${roomId}|${state}`);
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

        // The person left the direct chat: the bot leaves too, so nothing lingers on the homeserver. Someone else
        // leaving (a third person the person invited, or one who declined) leaves the chat as it was.
        if (membership === 'leave' || membership === 'ban') {
            const roomBot = await this.botForRoom(event.room_id);
            if (roomBot && !(await this.someoneStays(roomBot, event.room_id, event.state_key!))) {
                await this.client.leaveRoom(this.botUserId(roomBot), event.room_id).catch(() => undefined);
                await this.forgetRoom(event.room_id);
            }
        }
    }

    /** Whether a person other than the bot and the one who just left is still in the room. */
    private async someoneStays(botId: string, roomId: string, leaving: string): Promise<boolean> {
        const botUserId = this.botUserId(botId);
        let members = this.roomMembers.get(roomId);
        if (!members) {
            const joined = await this.client.getJoinedMembers(botUserId, roomId).catch((error) => {
                // Unknown members: leave as the person most likely was the only one, and say so.
                console.warn(`[MatrixDmBridge] Could not read the members of ${roomId}, leaving it:`, error?.message ?? error);
                return null;
            });
            if (!joined) return false;
            members = new Set(joined.filter((member) => member !== leaving));
            this.roomMembers.set(roomId, members);
        }
        return [...members].some((member) => member !== botUserId && member !== leaving);
    }

    /** A fresh answer from Orbit that this person may chat with the bot. Any refusal, failure or exception is a no. */
    private async mayJoin(botId: string, chatId: string): Promise<boolean> {
        try {
            return mayChat(await this.access(botId, chatId, true));
        } catch (error: any) {
            console.warn(`[MatrixDmBridge] Could not check access to bot ${botId}:`, error?.message ?? error);
            return false;
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
            if (config) await this.ensureBotAccount(botId, config);
        } catch (error: any) {
            // Synapse sends the invite only once, so decline it rather than leave the bot invited and silent; the
            // person can invite it again.
            console.warn(`[MatrixDmBridge] Could not take an invite for bot ${botId}:`, error?.message ?? error);
            await this.client.leaveRoom(botUserId, event.room_id).catch(() => undefined);
            return;
        }
        // A bot that is off or deleted takes no new chats. The game shows its state without needing a room.
        if (!config || config.enabled === false) {
            await this.client.leaveRoom(botUserId, event.room_id).catch(() => undefined);
            return;
        }
        // Ask Orbit before joining. A refusal, or Orbit not answering, never lets the bot in: the invite is declined and
        // the person can invite it again.
        if (!(await this.mayJoin(botId, event.sender))) {
            await this.client.leaveRoom(botUserId, event.room_id).catch(() => undefined);
            return;
        }
        if (!(await this.joinWithRetry(botUserId, event.room_id))) return;

        // Ask again now that the bot is in, before reading anything: a ban or a lost permission that landed during the
        // join still applies, and a person who is no longer allowed gets no history read.
        if (!(await this.mayJoin(botId, event.sender))) {
            await this.client.leaveRoom(botUserId, event.room_id).catch(() => undefined);
            return;
        }

        // People often type before the bot has joined. Synapse does not push those messages to a bot that was only
        // invited, so read them back and answer the ones that arrived since the invite.
        const missed = await this.client.getRecentMessages(botUserId, event.room_id, 20).catch(() => []);
        const fromThem = missed.filter((message) => message.type === 'm.room.message' && message.sender === event.sender);
        // Without the invite's time there is no telling which came after it, so only the latest gets an answer.
        const inviteTs = event.origin_server_ts;
        const earlier =
            inviteTs === undefined ? fromThem.slice(-1) : fromThem.filter((message) => (message.origin_server_ts ?? 0) >= inviteTs);

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
            const sent = await this.sendNote(botId, event.room_id, 'trouble', language, config);
            // A note that didn't get through leaves the next message in the batch to try again.
            if (!sent && batch) batch.troubleSent = false;
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
            // Until Orbit has said so often enough, a missing bot is Orbit not answering, never a deleted bot.
            if (this.confirmedGone(botId)) await this.closeChat(botId, event.room_id, language);
            else await couldNotAnswer();
            return;
        }
        this.botNotFound.delete(botId);

        // A message that waited is checked afresh: the person may have lost access while the bot rested.
        const access = await this.access(botId, event.sender, catchUp);
        if (accessCheckFailed(access)) {
            await couldNotAnswer(config);
            return;
        }
        // Only a verified, permitted person may have a message kept or answered. A refusal carries no identity, so
        // nothing from that person is kept, and they are told why. Orbit decides before the bot being off matters, so
        // someone who may not message the bot never learns it is resting.
        if (!mayChat(access)) {
            if (!catchUp) await this.sendNoteNowAndThen(botId, event.room_id, refusalNote(access), language, config);
            return;
        }
        const user = access.user!;
        // Chats started before bots had pictures get theirs with the next message; after that this costs nothing.
        void this.avatars?.update(this.botUserId(botId), config);
        if (config.enabled === false) {
            // Resting again is not a failed answer, so a message already tried keeps its count.
            await this.rememberWaiting(botId, event, attemptsOf(event));
            if (!catchUp) await this.sayResting(botId, event, config, language);
            return;
        }
        if (!config.aiProviderRef) {
            if (!catchUp) await this.sendNoteNowAndThen(botId, event.room_id, 'unready', language, config);
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
            uuid: user.uuid,
            name: user.name,
            isGuest: user.isGuest,
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
        let stepsSent: Promise<void> = Promise.resolve();
        let stepsEventId: string | undefined;
        const sentAt = event.origin_server_ts ?? Date.now();
        if (!catchUp) this.answeringLive.set(event.room_id, sentAt);
        try {
            const reply = await this.deps.reply(botId, person, text, attachments, {
                roomId: event.room_id,
                onInterimMessage: async (interim) => {
                    // A lost "let me look" line must not cost the person the real answer, so it never throws.
                    try {
                        await this.client.sendText(botUserId, event.room_id, interim);
                    } catch (error: any) {
                        console.warn(`[MatrixDmBridge] Could not send an interim message in ${event.room_id}:`, error?.message ?? error);
                    }
                    if (typing) startTyping();
                },
                onSteps: (field, text) => {
                    // One notice per reply, updated in place: notices and updates don't notify (#1545). In order, and
                    // never throwing: a lost steps line must not cost the person the answer.
                    stepsSent = stepsSent
                        .then(async () => {
                            const content = { msgtype: 'm.notice', body: text, [STEPS_KEY]: field };
                            if (!stepsEventId) {
                                stepsEventId = await this.client.sendMessage(botUserId, event.room_id, content);
                                return;
                            }
                            await this.client.sendMessage(botUserId, event.room_id, {
                                msgtype: 'm.notice',
                                body: `* ${text}`,
                                'm.new_content': content,
                                'm.relates_to': { rel_type: 'm.replace', event_id: stepsEventId },
                            });
                        })
                        .catch((error: any) =>
                            console.warn(`[MatrixDmBridge] Could not show the steps in ${event.room_id}:`, error?.message ?? error)
                        );
                    if (typing) startTyping();
                    return stepsSent;
                },
            });
            // Answered together with the messages that waited with it (#1159): that one answer was sent for all of them
            if (reply?.answeredTogether !== undefined) {
                answered = reply.answeredTogether;
                return;
            }
            // A reply limit (#1159): the fixed card instead of an answer, and the message is not tried again
            if (reply?.replyLimit) {
                await this.client.sendMessage(botUserId, event.room_id, replyLimitContent(reply.replyLimit, await this.botName(botId, config)));
                answered = true;
                return;
            }
            // No reply at all means the bot couldn't be set up to answer (no AI service here), and an empty one leaves the
            // person with nothing: say so, as for a failure.
            if (!reply || reply.failed || (!reply.text && !reply.media?.length && !reply.artifacts?.length)) {
                // A failed call is logged where it failed; these two were not logged anywhere (#1498)
                if (!reply) console.warn(`[MatrixDmBridge] Bot ${botId} could not answer in ${event.room_id}: no AI service here`);
                else if (!reply.failed) console.warn(`[MatrixDmBridge] Bot ${botId} could not answer in ${event.room_id}: the answer was empty`);
                await couldNotAnswer(config);
                return;
            }
            if (reply.roomLink && reply.text) {
                // A reply that names the bot's room carries it, so the game shows a card to go there.
                await this.client.sendMessage(botUserId, event.room_id, {
                    msgtype: 'm.text',
                    body: reply.text,
                    [ROOM_LINK_KEY]: reply.roomLink,
                });
            } else if (reply.text) {
                await this.client.sendText(botUserId, event.room_id, reply.text);
            }
            reply.keep?.();
            for (const card of reply.artifacts ?? []) {
                // A live artifact the bot made or changed: the game shows a card to open it
                const { body, field } = artifactDirectMessage(card);
                await this.client
                    .sendMessage(botUserId, event.room_id, { msgtype: 'm.text', body, [ARTIFACT_KEY]: field })
                    .catch((error) => console.warn(`[MatrixDmBridge] Could not send an artifact card from bot ${botId}:`, error?.message ?? error));
            }
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
            if (!catchUp) {
                // Noted as answered before it stops counting as being answered, so no check in between sees neither.
                if (answered) {
                    this.answeredLive.delete(event.room_id);
                    this.answeredLive.set(event.room_id, sentAt);
                    if (this.answeredLive.size > NOTE_TIMES_MAX) this.answeredLive.delete(this.answeredLive.keys().next().value!);
                }
                if (this.answeringLive.get(event.room_id) === sentAt) this.answeringLive.delete(event.room_id);
            }
        }
        // The bot is answering again, so anyone who wrote while it rested gets their answer now.
        if (answered && !catchUp) void this.drainIfWaiting(botId).catch(() => undefined);
    }

    /**
     * What the game shows about a bot (chat header, People). A bot Orbit can't find reads as gone only once that is
     * confirmed, as for closing its chats: until then Orbit may just be restarting, so it is unknown.
     */
    availability(botId: string, config: BotConfiguration | null): BotAvailability | 'unknown' {
        if (config) {
            this.botNotFound.delete(botId);
            return availabilityOf(config);
        }
        return this.confirmedGone(botId) ? 'gone' : 'unknown';
    }

    /** Orbit said this bot doesn't exist. True once it has said so BOT_GONE_AFTER times, far enough apart to believe it. */
    private confirmedGone(botId: string): boolean {
        const now = Date.now();
        const seen = this.botNotFound.get(botId);
        if (!seen) this.botNotFound.set(botId, { inARow: 1, at: now });
        else if (now - seen.at >= BOT_GONE_SPACING_MS) this.botNotFound.set(botId, { inARow: seen.inARow + 1, at: now });
        if (this.botNotFound.size > NOTE_TIMES_MAX) this.botNotFound.delete(this.botNotFound.keys().next().value!);
        return (this.botNotFound.get(botId)?.inARow ?? 0) >= BOT_GONE_AFTER;
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
            const sent = line
                ? await this.client.sendText(this.botUserId(botId), roomId, line).then(
                      () => true,
                      (error) => {
                          console.warn(`[MatrixDmBridge] Could not send a resting line in ${roomId}:`, error?.message ?? error);
                          return false;
                      }
                  )
                : false;
            // Only a line that reached the chat starts the quiet spell, so an empty or failed one is tried on the next message.
            if (!sent) this.lastRestingLine.delete(roomId);
        }
        await this.sendNoteNowAndThen(botId, roomId, 'resting', language, config);
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
            if (config === null && !this.confirmedGone(botId)) continue;
            if (config === null) {
                // Deleted: whoever left a message gets the goodbye now, and the bot leaves that chat.
                for (const event of this.readWaiting(await this.takeWaiting(botId))) {
                    if ((await this.botForRoom(event.room_id)) !== botId) continue;
                    await this.closeChat(botId, event.room_id, detectLanguage(String(event.content?.body ?? '')));
                }
            } else {
                this.botNotFound.delete(botId);
                if (config.enabled !== false && config.aiProviderRef) await this.drain(botId);
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
        if (this.stopping || this.draining.has(botId)) return;
        this.draining.add(botId);
        const run = this.runDrain(botId);
        this.drains.set(botId, run);
        try {
            await run;
        } finally {
            this.drains.delete(botId);
        }
    }

    private async runDrain(botId: string): Promise<void> {
        try {
            const messages = this.readWaiting(await this.takeWaiting(botId));
            if (this.stopping) {
                // Shutdown began while they were being taken: they go back in line for the next process.
                for (const event of messages) await this.rememberWaiting(botId, event, attemptsOf(event));
                return;
            }
            this.drainQueues.set(botId, messages);
            // Taken one at a time, so on shutdown stop() can put back whatever is left.
            for (let event = messages.shift(); event; event = messages.shift()) {
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
                if ((event.origin_server_ts ?? 0) <= (this.answeredLive.get(event.room_id) ?? -1)) {
                    // The person wrote again since and got an answer: only the newest message is answered, as when
                    // nothing waited, and the older one never comes after it.
                    console.info(`[MatrixDmBridge] Passing a waiting message for bot ${botId}: a newer one in ${event.room_id} was answered`);
                    continue;
                }
                if ((event.origin_server_ts ?? 0) <= (this.answeringLive.get(event.room_id) ?? -1)) {
                    // A newer message there is being answered right now: wait to see whether that answer lands.
                    await this.rememberWaiting(botId, event, attemptsOf(event));
                    continue;
                }
                await this.handleMessage(event, true).catch((error) =>
                    console.warn(`[MatrixDmBridge] Could not answer a waiting message for bot ${botId}:`, error?.message ?? error)
                );
            }
        } finally {
            this.drainQueues.delete(botId);
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
        if (!mediaType || typeof content.url !== 'string') {
            return { text: '', attachments: [] };
        }
        // A caption is carried in body when filename is set separately (Matrix v1.10).
        const filename = String(content.filename ?? content.body ?? 'file');
        const caption = content.filename && content.body && content.body !== content.filename ? String(content.body) : '';
        // With nowhere to put the file the bot can't read it: the person is told, rather than hearing nothing.
        if (!this.deps.uploadAttachment) return { text: caption, attachments: [], failed: true };
        try {
            const file = await this.client.downloadMedia(botUserId, content.url);
            const mimeType = String(content.info?.mimetype ?? file.contentType);
            const url = await this.deps.uploadAttachment(file.data, mimeType, filename);
            if (!url) return { text: caption, attachments: [], failed: true };
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
