/**
 * The chat rooms of a Brick that was purged for good (register R29; Khalid, 17 Nov: a deleted Brick keeps nothing). Orbit purges the Brick
 * and writes down that its chats are still to clear (where the Brick is, nothing else); only the bot server holds the Matrix account, so
 * it asks Orbit which Bricks are waiting, clears each one's rooms, and tells Orbit which are done. Orbit forgets a Brick's chat only when
 * told, so a restart in between loses none, and a room that could not be cleared is simply asked for again next round. Nothing a Brick
 * or a person said is ever logged.
 */
import axios from 'axios';

export interface ChatPurgeSweeperConfig {
    adminApiUrl: string | undefined;
    botServiceToken: string | undefined;
    /** Clears one Brick's chat rooms: true when nothing is left (also when it never had a chat account), false to be asked again. */
    purge: (botId: string) => Promise<boolean>;
    /** How often to look, in milliseconds. */
    everyMs?: number;
}

/** Most Bricks cleared in one round; the next round takes the rest. */
const BRICKS_PER_ROUND = 20;

export class ChatPurgeSweeper {
    private timer: ReturnType<typeof setInterval> | null = null;
    private running = false;

    constructor(private readonly config: ChatPurgeSweeperConfig) {}

    /** Whether there is everything to do it with. Without an Orbit and a token nothing is asked. */
    isConfigured(): boolean {
        return !!this.config.adminApiUrl && !!this.config.botServiceToken;
    }

    start(): void {
        if (this.timer || !this.isConfigured()) return;
        this.timer = setInterval(() => void this.sweep(), this.config.everyMs ?? 60_000);
        this.timer.unref?.();
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    /** One round. Returns how many Bricks were cleared and confirmed. Never throws. */
    async sweep(): Promise<number> {
        if (!this.isConfigured() || this.running) return 0;
        this.running = true;
        try {
            const headers = { Authorization: `Bearer ${this.config.botServiceToken}` };
            const listed = await axios.get(`${this.config.adminApiUrl}/api/brick-chat-purges`, { headers, timeout: 10_000 });
            const botIds: string[] = Array.isArray(listed.data?.purges)
                ? listed.data.purges.map((one: { botId?: unknown }) => one?.botId).filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
                : [];
            const done: string[] = [];
            for (const botId of botIds.slice(0, BRICKS_PER_ROUND)) {
                if (await this.config.purge(botId).catch(() => false)) done.push(botId);
            }
            if (done.length > 0) {
                await axios.post(`${this.config.adminApiUrl}/api/brick-chat-purges`, { botIds: done }, { headers, timeout: 10_000 });
            }
            return done.length;
        } catch (error) {
            // An Orbit without the route yet answers 404 or 405: nothing is waiting there, nothing to say
            const status = axios.isAxiosError(error) ? error.response?.status : undefined;
            if (status !== 404 && status !== 405) {
                console.warn(`[ChatPurges] Could not clear a deleted Brick's chats: ${axios.isAxiosError(error) ? (status ?? error.code ?? 'no answer') : 'failed'}`);
            }
            return 0;
        } finally {
            this.running = false;
        }
    }
}
