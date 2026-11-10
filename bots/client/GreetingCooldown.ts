/**
 * Free greetings with a cooldown (approved by Khalid 10 Nov 2026). When someone walks up, a bot greets them on its own. That greeting:
 *   - costs the person nothing: it is paid for by whoever's key the bot runs on, never counted in their Universe AI window, a bot's own
 *     limit per person or the guests' pool (the usage is sent marked as a greeting, see AIService.generateGreetingStream);
 *   - is never a voice reply: it stays in the chat, so it is never spoken and never counts as a spoken reply (BotClient);
 *   - is made at most once per cooldown for each bot and person. Orbit remembers the last one and the cooldown is Orbit's setting
 *     ("Greet the same person again after"). Stepping out of a bubble and back in, a reconnect or another device inside it gives
 *     no new greeting. The person can still talk to the bot at any time.
 * Only time and who the person is count: nothing about where anyone stands.
 *
 * A greeting is asked for (`claim`) just before the AI is asked for one, and handed back (`ended`) when no words of it reached the
 * chat after all, so the person is greeted next time.
 */

/** Who a greeting is for, as Orbit counts people: their id as the game gave it and whether they are a guest. */
export interface GreetingTalker {
    userId: string;
    isGuest: boolean;
}

/** Orbit's answer. `greetedAt` is the claim to hand back with; missing when nothing was remembered (an Orbit from before, no Orbit). */
export type GreetingClaim = { greet: true; greetedAt?: string } | { greet: false };

export interface GreetingOrbit {
    claimGreeting(botId: string, talker: GreetingTalker): Promise<GreetingClaim>;
    releaseGreeting(botId: string, talker: GreetingTalker & { greetedAt: string }): Promise<void>;
}

/** The marker in a greeting's reply id. It sits before "-player-", so the person it is for is read from the id as for any reply. */
const GREETING_MARK = '-greeting';

/** A new id for a greeting reply to this person: "bot-<bot>-greeting-player-<id>-<uuid>". */
export function greetingReplyId(botId: string, playerId: number): string {
    return `bot-${botId}${GREETING_MARK}-player-${playerId}-${crypto.randomUUID()}`;
}

/** Whether a reply id is a greeting's. */
export function isGreetingReply(responseId: string): boolean {
    return responseId.startsWith('bot-') && responseId.includes(`${GREETING_MARK}-player-`);
}

/** The person a greeting reply is for. */
export function greetingPersonOf(responseId: string): number | undefined {
    const at = responseId.lastIndexOf('-player-');
    if (at < 0) return undefined;
    const digits = /^\d+/.exec(responseId.slice(at + '-player-'.length));
    return digits ? Number(digits[0]) : undefined;
}

interface Claimed {
    talker: GreetingTalker;
    greetedAt?: string;
    made: boolean;
}

export class GreetingCooldown {
    private readonly claims = new Map<number, Claimed>();

    constructor(
        private readonly botId: string,
        private readonly orbit: GreetingOrbit | null
    ) {}

    /**
     * May the bot greet this person now? Asks Orbit, which remembers a yes at once. A person nobody can name yet, or a bot with no
     * Orbit to ask, is greeted as before. Never throws: when Orbit can't answer there is no greeting (the person can still talk).
     */
    async claim(personId: number, talker: GreetingTalker | null): Promise<boolean> {
        if (!talker || !this.orbit) return true;
        let answer: GreetingClaim;
        try {
            answer = await this.orbit.claimGreeting(this.botId, talker);
        } catch {
            return false;
        }
        if (!answer.greet) return false;
        this.claims.set(personId, { talker, greetedAt: answer.greetedAt, made: false });
        return true;
    }

    /** Words of a greeting for this person reached the chat: it was made. */
    made(personId: number): void {
        const claimed = this.claims.get(personId);
        if (claimed) claimed.made = true;
    }

    /** The greeting for this person is over. One that never reached the chat is handed back, in the background. */
    ended(personId: number): void {
        const claimed = this.claims.get(personId);
        if (!claimed) return;
        this.claims.delete(personId);
        if (claimed.made || !claimed.greetedAt || !this.orbit) return;
        this.orbit.releaseGreeting(this.botId, { ...claimed.talker, greetedAt: claimed.greetedAt }).catch(() => undefined);
    }
}
