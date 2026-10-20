import { readable, type Readable } from "svelte/store";

/** As long as the bot server keeps Orbit's answer, so an owner's change reaches Message within the same time. */
export const DM_ACCESS_TTL_MS = 30 * 1000;

type Ask = (botId: string) => Promise<boolean>;

/**
 * Whether you may message a bot, for its Message button. The owner picks who may (Orbit decides), and people who may
 * not never see the button. Asked only for bots someone looks at, once per bot at a time, and kept for 30 seconds.
 * Until the answer comes, and whenever it can't be found out, the answer is no: the bot could not answer anyway.
 */
export class BotDmAccessCache {
    private answers = new Map<string, { allowed: boolean; at: number }>();
    private asking = new Map<string, Promise<boolean>>();

    constructor(private ask: Ask, private now: () => number = Date.now) {}

    store(botId: string): Readable<boolean> {
        return readable(this.answers.get(botId)?.allowed ?? false, (set) => {
            let live = true;
            this.get(botId)
                .then((allowed) => {
                    if (live) set(allowed);
                })
                .catch(() => undefined);
            return () => {
                live = false;
            };
        });
    }

    async get(botId: string): Promise<boolean> {
        const known = this.answers.get(botId);
        if (known && this.now() - known.at < DM_ACCESS_TTL_MS) return known.allowed;
        const pending = this.asking.get(botId);
        if (pending) return pending;
        const question = this.ask(botId)
            .catch(() => false)
            .then((allowed) => {
                this.answers.set(botId, { allowed, at: this.now() });
                return allowed;
            })
            .finally(() => this.asking.delete(botId));
        this.asking.set(botId, question);
        return question;
    }
}
