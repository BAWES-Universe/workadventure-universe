import axios from 'axios';
import type { MatrixAppServiceClient } from './MatrixAppServiceClient';
import type { MatrixEvent, MatrixEventHandler } from './MatrixAppServiceRouter';
import { BOT_LOCALPART_PREFIX, botIdFromMatrixId, type MatrixAppServiceConfig } from './MatrixConfig';
import type { BotConfiguration } from '../server/AdminApiService';
import type { DmAttachment, DmPerson, DmReply, DmReplyHooks } from '../server/DmReplyService';
import type { PendingMedia } from '../memory/ConversationMemory';

export interface DmAccessResult {
    allowed: boolean;
    reason: string | null;
    user: { uuid: string; name: string | null; isGuest: boolean } | null;
}

export interface MatrixDmBridgeDeps {
    getBotConfig(botId: string): Promise<BotConfiguration | null>;
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
}

const ACCESS_CACHE_MS = 60 * 1000;
/** Most person-and-bot pairs whose access is cached; the oldest are dropped first. */
const ACCESS_CACHE_MAX = 5000;
const REFUSAL_REPEAT_MS = 10 * 60 * 1000;
const TYPING_DELAY_MS = 800;
const MAX_OUTGOING_MEDIA_BYTES = 50 * 1024 * 1024;
const REFUSAL = "Sorry, I can only chat with people who can visit my room.";
const ONLY_DIRECT = 'I only take direct messages.';

/**
 * Turns Matrix events for bot accounts into replies. A bot joins a direct chat when someone allowed to reach its room
 * invites it, answers each message there with DmReplyService, and leaves when the person leaves.
 */
export class MatrixDmBridge implements MatrixEventHandler {
    private roomBots = new Map<string, string>();
    private namedBots = new Set<string>();
    private accessCache = new Map<string, { result: DmAccessResult; at: number }>();
    private lastRefusal = new Map<string, number>();
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

    async userExists(userId: string): Promise<boolean> {
        const botId = botIdFromMatrixId(this.config.domain, userId);
        if (!botId) return false;
        const config = await this.deps.getBotConfig(botId);
        if (!config || config.enabled === false) return false;
        await this.ensureBotAccount(botId, config.name);
        return true;
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
        if (name && !this.namedBots.has(botId)) {
            await this.client.setDisplayName(this.botUserId(botId), name).catch((error) =>
                console.warn(`[MatrixDmBridge] Could not set the display name of bot ${botId}:`, error?.message ?? error)
            );
            this.namedBots.add(botId);
        }
    }

    private async rememberRoom(roomId: string, botId: string): Promise<void> {
        this.roomBots.set(roomId, botId);
        await this.deps.rooms?.rememberDmRoom(roomId, botId).catch(() => undefined);
    }

    private async forgetRoom(roomId: string): Promise<void> {
        this.roomBots.delete(roomId);
        this.roomMembers.delete(roomId);
        this.lastRefusal.delete(roomId);
        await this.deps.rooms?.forgetDmRoom(roomId).catch(() => undefined);
    }

    private async botForRoom(roomId: string): Promise<string | null> {
        const known = this.roomBots.get(roomId);
        if (known) return known;
        const stored = await this.deps.rooms?.getDmRoomBot(roomId).catch(() => null);
        if (stored) this.roomBots.set(roomId, stored);
        return stored ?? null;
    }

    private async access(botId: string, chatId: string, fresh = false): Promise<DmAccessResult> {
        const key = `${botId}|${chatId}`;
        const cached = this.accessCache.get(key);
        if (!fresh && cached && Date.now() - cached.at < ACCESS_CACHE_MS) return cached.result;
        const result = await this.deps.checkAccess(botId, chatId);
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
            } else if ((membership === 'leave' || membership === 'ban') && this.roomBots.get(event.room_id) === botId) {
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
        const config = await this.deps.getBotConfig(botId);
        if (!config || config.enabled === false) {
            await this.client.leaveRoom(botUserId, event.room_id).catch(() => undefined);
            return;
        }
        await this.ensureBotAccount(botId, config.name);
        if (!(await this.joinWithRetry(botUserId, event.room_id))) return;
        // Check after joining, so a ban that lands while the join is retried still applies.
        const access = await this.access(botId, event.sender, true);
        if (!access.allowed) {
            await this.client.sendText(botUserId, event.room_id, REFUSAL).catch(() => undefined);
            await this.client.leaveRoom(botUserId, event.room_id).catch(() => undefined);
            return;
        }
        await this.rememberRoom(event.room_id, botId);

        // People often type before the bot has joined. Synapse does not push those messages to a bot that was only
        // invited, so read them back and answer the ones that arrived since the invite.
        const missed = await this.client.getRecentMessages(botUserId, event.room_id, 20).catch(() => []);
        const inviteTs = event.origin_server_ts ?? 0;
        for (const earlier of missed) {
            if (earlier.type === 'm.room.message' && earlier.sender === event.sender && (earlier.origin_server_ts ?? 0) >= inviteTs) {
                await this.onMessage({ ...earlier, room_id: event.room_id });
            }
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

    private async onMessage(event: MatrixEvent): Promise<void> {
        // Ignore other bots (ours included), edits and notices.
        if (botIdFromMatrixId(this.config.domain, event.sender)) return;
        const content = event.content ?? {};
        if (content['m.relates_to']?.rel_type === 'm.replace' || content.msgtype === 'm.notice') return;
        if (!this.firstSighting(event.event_id)) return;

        const botId = await this.botForRoom(event.room_id);
        if (!botId) return;
        const botUserId = this.botUserId(botId);

        // Someone added a third person: the room is no longer a one-to-one chat, so the bot stays quiet.
        let members = this.roomMembers.get(event.room_id);
        if (!members) {
            const joined = await this.client.getJoinedMembers(botUserId, event.room_id).catch(() => null);
            if (!joined) return;
            members = new Set(joined);
            this.roomMembers.set(event.room_id, members);
        }
        if (members.size !== 2 || !members.has(event.sender)) return;

        const access = await this.access(botId, event.sender);
        if (!access.allowed || !access.user) {
            const last = this.lastRefusal.get(event.room_id) ?? 0;
            if (Date.now() - last > REFUSAL_REPEAT_MS) {
                this.lastRefusal.set(event.room_id, Date.now());
                await this.client.sendText(botUserId, event.room_id, REFUSAL).catch(() => undefined);
            }
            return;
        }

        const { text, attachments } = await this.readMessage(botUserId, content);
        if (!text && attachments.length === 0) return;

        const person: DmPerson = {
            matrixUserId: event.sender,
            uuid: access.user.uuid,
            name: access.user.name,
            isGuest: access.user.isGuest,
        };
        // Show "typing" only when the reply takes a moment, like a person would; quick replies need no extra calls.
        let typing = false;
        const startTyping = () => {
            typing = true;
            void this.client.setTyping(botUserId, event.room_id, true).catch(() => undefined);
        };
        let typingTimer: NodeJS.Timeout | undefined = setTimeout(startTyping, TYPING_DELAY_MS);
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
            if (reply?.text) await this.client.sendText(botUserId, event.room_id, reply.text);
            for (const item of reply?.media ?? []) {
                await this.sendMedia(botUserId, event.room_id, item).catch((error) =>
                    console.warn(`[MatrixDmBridge] Could not send media from bot ${botId}:`, error?.message ?? error)
                );
            }
        } finally {
            clearTimeout(typingTimer);
            typingTimer = undefined;
            if (typing) await this.client.setTyping(botUserId, event.room_id, false).catch(() => undefined);
        }
    }

    /** The message text, plus any file in it re-hosted where the bot can read it. */
    private async readMessage(botUserId: string, content: Record<string, any>): Promise<{ text: string; attachments: DmAttachment[] }> {
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
            return { text: caption, attachments: [] };
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
