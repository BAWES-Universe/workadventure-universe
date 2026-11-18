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

/**
 * Most pages read in one round. Orbit lists a page at a time and says where the next one starts (`next`): a Brick that cannot be cleared for now
 * stays listed, so the round reads on past it and never stops at the first page. A guard only, far above any real list; the next round starts again.
 */
const PAGES_PER_ROUND = 200;

export class ChatPurgeSweeper {
    private timer: ReturnType<typeof setInterval> | null = null;
    private running = false;
    /** Set at shutdown: no further Brick or page is started. */
    private stopped = false;
    /** The round under way, so shutdown can wait for it. */
    private active: Promise<number> | null = null;

    constructor(private readonly config: ChatPurgeSweeperConfig) {}

    /** Whether there is everything to do it with. Without an Orbit and a token nothing is asked. */
    isConfigured(): boolean {
        return !!this.config.adminApiUrl && !!this.config.botServiceToken;
    }

    start(): void {
        if (this.timer || this.stopped || !this.isConfigured()) return;
        this.timer = setInterval(() => void this.sweep(), this.config.everyMs ?? 60_000);
        this.timer.unref?.();
    }

    /**
     * Stops asking for more and waits, at most `graceMs`, for the Brick being cleared right now. Whatever does not finish is not confirmed, so
     * Orbit lists it again for the next bot server.
     */
    async stop(graceMs = 0): Promise<void> {
        this.stopped = true;
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        const active = this.active;
        if (!active) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([active.catch(() => undefined), new Promise<void>((resolve) => (timer = setTimeout(resolve, graceMs)))]);
        if (timer) clearTimeout(timer);
    }

    /** One round. Returns how many Bricks were cleared and confirmed (the ones Orbit acknowledged). Never throws. */
    sweep(): Promise<number> {
        if (!this.isConfigured() || this.running || this.stopped) return Promise.resolve(0);
        this.running = true;
        const round = this.round().finally(() => {
            this.running = false;
            this.active = null;
        });
        this.active = round;
        return round;
    }

    private async round(): Promise<number> {
        let cleared = 0;
        try {
            const headers = { Authorization: `Bearer ${this.config.botServiceToken}` };
            let after: string | undefined;
            for (let page = 0; page < PAGES_PER_ROUND && !this.stopped; page++) {
                const listed = await axios.get(`${this.config.adminApiUrl}/api/brick-chat-purges`, { headers, params: after ? { after } : undefined, timeout: 10_000 });
                const botIds: string[] = Array.isArray(listed.data?.purges)
                    ? listed.data.purges.map((one: { botId?: unknown }) => one?.botId).filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
                    : [];
                const done: string[] = [];
                for (const botId of botIds) {
                    if (this.stopped) break;
                    if (await this.config.purge(botId).catch(() => false)) done.push(botId);
                }
                // Confirmed page by page, so what was cleared is never cleared twice if a later page fails
                if (done.length > 0) {
                    await axios.post(`${this.config.adminApiUrl}/api/brick-chat-purges`, { botIds: done }, { headers, timeout: 10_000 });
                    cleared += done.length;
                }
                // An Orbit that sends no `next` sends the single page it always did; a `next` that does not move on ends the round
                const next = typeof listed.data?.next === 'string' && listed.data.next.length > 0 ? listed.data.next : undefined;
                if (!next || next === after) break;
                after = next;
            }
            return cleared;
        } catch (error) {
            // An Orbit without the route yet answers 404 or 405: nothing is waiting there, nothing to say
            const status = axios.isAxiosError(error) ? error.response?.status : undefined;
            if (status !== 404 && status !== 405) {
                console.warn(`[ChatPurges] Could not clear a deleted Brick's chats: ${axios.isAxiosError(error) ? (status ?? error.code ?? 'no answer') : 'failed'}`);
            }
            // What Orbit already acknowledged before the failure is still cleared
            return cleared;
        }
    }
}
