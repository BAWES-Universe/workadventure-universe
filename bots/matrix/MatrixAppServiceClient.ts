import axios, { type AxiosInstance } from 'axios';
import { randomUUID } from 'crypto';
import type { MatrixAppServiceConfig } from './MatrixConfig';
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

    async sendMessage(userId: string, roomId: string, content: Record<string, unknown>): Promise<string> {
        const response = await this.http.put(
            `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${randomUUID()}`,
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

    /** The latest messages in a room, oldest first, read as a bot that is in it. */
    async getRecentMessages(userId: string, roomId: string, limit = 20): Promise<MatrixEvent[]> {
        const response = await this.http.get(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`, {
            params: { user_id: userId, dir: 'b', limit },
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
}
