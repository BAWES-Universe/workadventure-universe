import axios, { type AxiosInstance } from 'axios';
import { randomUUID } from 'crypto';
import { botIdFromMatrixId, type MatrixAppServiceConfig } from './MatrixConfig';
import type { MatrixEvent } from './MatrixAppServiceRouter';

/**
 * Calls the homeserver as the application service. Every call names the bot it acts for with ?user_id=, so one
 * token and one HTTP client serve every bot. Nothing here keeps a connection or a timer per bot.
 */
export class MatrixAppServiceClient {
    private http: AxiosInstance;
    private registered = new Set<string>();

    constructor(private config: MatrixAppServiceConfig) {
        this.http = axios.create({
            baseURL: config.homeserverUrl,
            headers: { Authorization: `Bearer ${config.asToken}` },
            timeout: 15000,
        });
    }

    /** Create the bot's Matrix account if it does not exist yet. Safe to call again. */
    async ensureRegistered(localpart: string): Promise<void> {
        if (this.registered.has(localpart)) return;
        const response = await this.http.post(
            '/_matrix/client/v3/register',
            { type: 'm.login.application_service', username: localpart, inhibit_login: true },
            { validateStatus: () => true }
        );
        if (response.status !== 200 && response.data?.errcode !== 'M_USER_IN_USE') {
            throw new Error(`Matrix register ${localpart} failed: ${response.status} ${response.data?.errcode ?? ''}`);
        }
        this.registered.add(localpart);
    }

    async setDisplayName(userId: string, displayName: string): Promise<void> {
        await this.http.put(
            `/_matrix/client/v3/profile/${encodeURIComponent(userId)}/displayname`,
            { displayname: displayName },
            { params: { user_id: userId } }
        );
    }

    /** The display name a user has on the homeserver, or null when it has none. */
    async getDisplayName(userId: string): Promise<string | null> {
        const response = await this.http.get(`/_matrix/client/v3/profile/${encodeURIComponent(userId)}/displayname`, {
            params: { user_id: userId },
            validateStatus: () => true,
        });
        return response.status === 200 && typeof response.data?.displayname === 'string' ? response.data.displayname : null;
    }

    /** The user's chat picture (mxc://), or null when they have none. Throws when the homeserver can't say. */
    async getAvatarUrl(userId: string): Promise<string | null> {
        const response = await this.http.get(`/_matrix/client/v3/profile/${encodeURIComponent(userId)}/avatar_url`, {
            params: { user_id: userId },
            validateStatus: () => true,
        });
        if (response.status === 404) return null;
        if (response.status !== 200) throw new Error(`Matrix avatar_url of ${userId}: ${response.status} ${response.data?.errcode ?? ''}`);
        return typeof response.data?.avatar_url === 'string' && response.data.avatar_url ? response.data.avatar_url : null;
    }

    async setAvatarUrl(userId: string, mxcUri: string): Promise<void> {
        await this.http.put(
            `/_matrix/client/v3/profile/${encodeURIComponent(userId)}/avatar_url`,
            { avatar_url: mxcUri },
            { params: { user_id: userId } }
        );
    }

    /** The user's own account data of this type, or undefined when there is none. Throws when the homeserver can't say. */
    async getAccountData(userId: string, type: string): Promise<unknown> {
        const response = await this.http.get(
            `/_matrix/client/v3/user/${encodeURIComponent(userId)}/account_data/${encodeURIComponent(type)}`,
            { params: { user_id: userId }, validateStatus: () => true }
        );
        if (response.status === 404) return undefined;
        if (response.status !== 200) throw new Error(`Matrix account data of ${userId}: ${response.status} ${response.data?.errcode ?? ''}`);
        return response.data;
    }

    async setAccountData(userId: string, type: string, content: object): Promise<void> {
        await this.http.put(
            `/_matrix/client/v3/user/${encodeURIComponent(userId)}/account_data/${encodeURIComponent(type)}`,
            content,
            { params: { user_id: userId } }
        );
    }

    async joinRoom(userId: string, roomId: string): Promise<void> {
        await this.http.post(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/join`, {}, { params: { user_id: userId } });
    }

    async leaveRoom(userId: string, roomId: string, reason?: string): Promise<void> {
        await this.http.post(
            `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/leave`,
            reason ? { reason } : {},
            { params: { user_id: userId } }
        );
    }

    /**
     * Forget a room that was left, so the homeserver drops its history for this user. A room it no longer knows counts as forgotten. Waits out
     * the homeserver's own "slow down" a few times, like a redaction.
     */
    async forgetRoom(userId: string, roomId: string): Promise<void> {
        for (let attempt = 0; ; attempt++) {
            const response = await this.http.post(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/forget`, {}, { params: { user_id: userId }, validateStatus: () => true });
            if (response.status === 200 || response.status === 404 || response.data?.errcode === 'M_NOT_FOUND') return;
            if (response.status === 429 && attempt < 5) {
                await this.waitOut(response.data?.retry_after_ms);
                continue;
            }
            throw new Error(`Matrix forget ${roomId} failed: ${response.status} ${response.data?.errcode ?? ''}`);
        }
    }

    private async waitOut(retryAfterMs: unknown): Promise<void> {
        const wait = Number(retryAfterMs);
        await new Promise((resolve) => setTimeout(resolve, Math.min(Number.isFinite(wait) && wait > 0 ? wait : 1000, 30_000)));
    }

    /**
     * The rooms this user has joined, or null when the user has no account on the homeserver (it was never made, so there is nothing to purge).
     * A refusal (403) is told apart by asking whether the account exists at all: Synapse's code for "the application service has not registered
     * this user" differs by version, and an out-of-namespace refusal carries the same code, so the code alone proves nothing. An answer that is
     * not a list of rooms is a failure, never an empty list. Throws on anything else.
     */
    async getJoinedRooms(userId: string): Promise<string[] | null> {
        const response = await this.http.get('/_matrix/client/v3/joined_rooms', { params: { user_id: userId }, validateStatus: () => true });
        if (response.status === 200) {
            const rooms = response.data?.joined_rooms;
            if (!Array.isArray(rooms) || !rooms.every((id: unknown) => typeof id === 'string')) throw new Error(`Matrix joined rooms of ${userId}: the answer is not a list of rooms`);
            return rooms;
        }
        // Only a user inside this application service's namespace can be "not registered yet"; for anyone else a 403 is a real refusal, whatever the profile says
        if (response.status === 403 && botIdFromMatrixId(this.config.domain, userId) !== null && (await this.accountExists(userId)) === false) return null;
        throw new Error(`Matrix joined rooms of ${userId}: ${response.status} ${response.data?.errcode ?? ''}`);
    }

    /** Whether the homeserver has an account for this user (its profile is there). Throws when it cannot say. */
    async accountExists(userId: string): Promise<boolean> {
        const response = await this.http.get(`/_matrix/client/v3/profile/${encodeURIComponent(userId)}`, { validateStatus: () => true });
        if (response.status === 200) return true;
        if (response.status === 404) return false;
        throw new Error(`Matrix profile of ${userId}: ${response.status} ${response.data?.errcode ?? ''}`);
    }

    /** The user's name and picture as the homeserver shows them, each null when there is none. Throws when the homeserver cannot say. */
    async getProfile(userId: string): Promise<{ displayName: string | null; avatarUrl: string | null }> {
        const response = await this.http.get(`/_matrix/client/v3/profile/${encodeURIComponent(userId)}`, { validateStatus: () => true });
        if (response.status !== 200) throw new Error(`Matrix profile of ${userId}: ${response.status} ${response.data?.errcode ?? ''}`);
        const text = (value: unknown) => (typeof value === 'string' && value ? value : null);
        return { displayName: text(response.data?.displayname), avatarUrl: text(response.data?.avatar_url) };
    }

    /**
     * One page of a room's history, newest first, read as a user that is in it. `from` is the previous page's `end`; a page with no `end`
     * (or no events) is the last one.
     */
    async getMessagesPage(userId: string, roomId: string, from?: string, limit = 100): Promise<{ events: MatrixEvent[]; end?: string }> {
        const response = await this.http.get(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`, {
            params: { user_id: userId, dir: 'b', limit, ...(from ? { from } : {}) },
        });
        return { events: (response.data?.chunk ?? []) as MatrixEvent[], end: typeof response.data?.end === 'string' ? response.data.end : undefined };
    }

    /**
     * Redacts an event this user sent (Matrix keeps the event's place and drops what it said). The same `txnId` for the same event, so a
     * retry never makes a second redaction. Waits out the homeserver's own "slow down" a few times.
     */
    async redactEvent(userId: string, roomId: string, eventId: string, txnId: string, reason?: string): Promise<void> {
        for (let attempt = 0; ; attempt++) {
            const response = await this.http.put(
                `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}/${encodeURIComponent(txnId)}`,
                reason ? { reason } : {},
                { params: { user_id: userId }, validateStatus: () => true }
            );
            if (response.status === 200) return;
            if (response.status === 429 && attempt < 5) {
                await this.waitOut(response.data?.retry_after_ms);
                continue;
            }
            throw new Error(`Matrix redact in ${roomId} failed: ${response.status} ${response.data?.errcode ?? ''}`);
        }
    }

    /** Takes the name and the picture off a user's profile (an empty value removes it). Throws when the homeserver refuses. */
    async clearProfile(userId: string): Promise<void> {
        await this.http.put(`/_matrix/client/v3/profile/${encodeURIComponent(userId)}/displayname`, { displayname: '' }, { params: { user_id: userId } });
        await this.http.put(`/_matrix/client/v3/profile/${encodeURIComponent(userId)}/avatar_url`, { avatar_url: '' }, { params: { user_id: userId } });
    }

    /** Sends a message as this user. A retry passes the first try's `txnId`, so Matrix keeps one message, not two. */
    async sendMessage(userId: string, roomId: string, content: Record<string, unknown>, txnId: string = randomUUID()): Promise<string> {
        const response = await this.http.put(
            `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`,
            content,
            { params: { user_id: userId } }
        );
        return response.data?.event_id;
    }

    async sendText(userId: string, roomId: string, text: string): Promise<string> {
        return this.sendMessage(userId, roomId, { msgtype: 'm.text', body: text });
    }

    async setTyping(userId: string, roomId: string, typing: boolean, timeoutMs = 30000): Promise<void> {
        await this.http.put(
            `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(userId)}`,
            typing ? { typing: true, timeout: timeoutMs } : { typing: false },
            { params: { user_id: userId } }
        );
    }

    /** Matrix IDs of everyone joined to a room, read as a bot that is in it. */
    async getJoinedMembers(userId: string, roomId: string): Promise<string[]> {
        const response = await this.http.get(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/joined_members`, {
            params: { user_id: userId },
        });
        return Object.keys(response.data?.joined ?? {});
    }

    /** One event of a room, read as a bot that is in it; null when it is not there or the bot may not read it. */
    async getEvent(userId: string, roomId: string, eventId: string): Promise<MatrixEvent | null> {
        try {
            const response = await this.http.get(
                `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`,
                { params: { user_id: userId } }
            );
            return (response.data as MatrixEvent) ?? null;
        } catch {
            return null;
        }
    }

    /** The latest messages in a room, oldest first, read as a bot that is in it. `filter`: a Matrix room event filter (e.g. only some types or senders), so `limit` counts only those. */
    async getRecentMessages(userId: string, roomId: string, limit = 20, filter?: { types?: string[]; senders?: string[] }): Promise<MatrixEvent[]> {
        const response = await this.http.get(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`, {
            params: { user_id: userId, dir: 'b', limit, ...(filter ? { filter: JSON.stringify(filter) } : {}) },
        });
        return ((response.data?.chunk ?? []) as MatrixEvent[]).reverse();
    }

    /** Upload bytes to the homeserver's media repository and return the mxc:// URI. */
    async uploadMedia(userId: string, data: Buffer, contentType: string, filename?: string): Promise<string> {
        const response = await this.http.post('/_matrix/media/v3/upload', data, {
            params: { user_id: userId, ...(filename ? { filename } : {}) },
            headers: { 'Content-Type': contentType },
            maxBodyLength: 50 * 1024 * 1024,
            timeout: 60000,
        });
        return response.data?.content_uri;
    }

    /** Download a file someone sent in a room (authenticated media). */
    async downloadMedia(userId: string, mxcUri: string): Promise<{ data: Buffer; contentType: string }> {
        const match = /^mxc:\/\/([^/]+)\/([^/?#]+)$/.exec(mxcUri);
        if (!match) throw new Error(`Not an mxc URI: ${mxcUri}`);
        const response = await this.http.get(
            `/_matrix/client/v1/media/download/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`,
            { params: { user_id: userId }, responseType: 'arraybuffer', timeout: 60000, maxContentLength: 50 * 1024 * 1024 }
        );
        return { data: Buffer.from(response.data), contentType: String(response.headers['content-type'] || 'application/octet-stream') };
    }

    /**
     * Who the homeserver says the application service is. A registered as_token answers 200 with the sender's ID
     * (@universe-bots:<domain>); a token Synapse does not know answers 401 M_UNKNOWN_TOKEN. Network errors throw.
     */
    async whoami(timeoutMs = 15000): Promise<{ ok: true; userId: string } | { ok: false; status: number; errcode?: string }> {
        const response = await this.http.get('/_matrix/client/v3/account/whoami', { validateStatus: () => true, timeout: timeoutMs });
        if (response.status === 200 && typeof response.data?.user_id === 'string') {
            return { ok: true, userId: response.data.user_id };
        }
        return { ok: false, status: response.status, errcode: response.data?.errcode };
    }
}
