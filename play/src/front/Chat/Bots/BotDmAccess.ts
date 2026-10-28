import { readable, type Readable } from "svelte/store";

/** As long as the bot server keeps Orbit's answer, so an owner's change reaches Message within the same time. */
export const DM_ACCESS_TTL_MS = 30 * 1000;
/** While someone keeps looking and the answer can't be found out, ask again after this long, a few times. */
export const DM_ACCESS_RETRY_MS = 5 * 1000;
export const DM_ACCESS_RETRIES = 3;

/** Yes, no, or null when it could not be found out (the bot server or Orbit too slow, or down). */
type Ask = (botId: string) => Promise<boolean | null>;

/**
 * Whether you may message a bot, for its Message button. The owner picks who may (Orbit decides), and people who may
 * not never see the button. Asked only for bots someone looks at, once per bot at a time, and kept for 30 seconds.
 * Until the answer comes, and whenever it can't be found out, the answer is no: the bot could not answer anyway.
 * Only a real yes or no is kept: "could not find out" is asked again on the next look, so a slow moment does not hide
 * Message for 30 seconds. A store that stays open while that happens asks again a few seconds later (3 more times),
 * so a slow moment does not hide Message until the screen is opened again.
 */
export class BotDmAccessCache {
    private answers = new Map<string, { allowed: boolean; at: number }>();
    private asking = new Map<string, Promise<boolean | null>>();

    constructor(private ask: Ask, private now: () => number = Date.now) {}

    store(botId: string): Readable<boolean> {
        // Start from a kept answer only while it is fresh: an old yes may have been taken back since
        const known = this.answers.get(botId);
        const fresh = known !== undefined && this.now() - known.at < DM_ACCESS_TTL_MS;
        return readable(fresh ? known.allowed : false, (set) => {
            let live = true;
            let retries = 0;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const look = () => {
                this.lookup(botId)
                    .then((allowed) => {
                        if (!live) return;
                        if (allowed !== null) {
                            set(allowed);
                        } else if (retries++ < DM_ACCESS_RETRIES) {
                            timer = setTimeout(look, DM_ACCESS_RETRY_MS);
                        }
                    })
                    .catch(() => undefined);
            };
            look();
            return () => {
                live = false;
                if (timer !== undefined) clearTimeout(timer);
            };
        });
    }

    async get(botId: string): Promise<boolean> {
        return (await this.lookup(botId)) ?? false;
    }

    /** The kept or fresh answer, or null when it could not be found out. */
    private lookup(botId: string): Promise<boolean | null> {
        const known = this.answers.get(botId);
        if (known && this.now() - known.at < DM_ACCESS_TTL_MS) return Promise.resolve(known.allowed);
        const pending = this.asking.get(botId);
        if (pending) return pending;
        const question = this.ask(botId)
            .catch(() => null)
            .then((allowed) => {
                if (allowed !== null) this.answers.set(botId, { allowed, at: this.now() });
                return allowed;
            })
            .finally(() => this.asking.delete(botId));
        this.asking.set(botId, question);
        return question;
    }
}
