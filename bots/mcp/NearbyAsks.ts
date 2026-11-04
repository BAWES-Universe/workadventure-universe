/**
 * Cards in nearby chat and voice (game #1658, mock 4 approved 4 Nov 2026): the bot server's side of where they go.
 *
 * A bubble is shared, so the card, its endings and the replies only the asker needs go to that person alone, as private
 * events the game pusher passes on only from a bot about itself. Everyone in the bubble reads (and hears, from a voice
 * bot) one plain line instead. A tap comes back as a private event from the person to the bot: it names the card and the
 * revision it saw, and ToolApprovals (with Orbit) decides what it means.
 */
import type { SpaceUser } from '@workadventure/messages';
import type { BotClient } from '../client/BotClient';
import type { Asker, NearbySurface } from './ToolApprovals';
import { parseTap } from './ApprovalCard';
import type { AskField } from './ApprovalCard';

/** Bots are known by the tag or by the uuid prefix their token gives them (the same test the game server uses). */
export function isBotSpaceUser(user: SpaceUser): boolean {
    return user.tags?.includes('bot') || user.uuid?.startsWith('bot-') || false;
}

/** What a bot's client needs of the cards: where taps and people coming back go. */
export interface BotAsksPort {
    /** A tap on a card, from the person with this player id. */
    tap(bot: BotClient, spaceName: string, playerId: number, answer: { askId: string; revision: number; tap: string }): void;
    /** A person joined the bubble: if they had cards or replies, they come back on their screen. */
    personBack(bot: BotClient, spaceName: string, playerId: number): void;
}

/** What the cards need of the cards' side: finding a bot, and a short word from the bot's own AI. */
export interface NearbyAsksDeps {
    bot(botId: string): BotClient | null;
    /** One short AI reply with the bot's own provider. Throws or answers '' when it fails. */
    quick(botId: string, system: string, prompt: string, timeoutMs: number): Promise<string>;
    /** The cards. Late: the bot server builds them after the bots exist. */
    approvals(): {
        handleTap(botId: string, roomId: string, person: Asker, tap: NonNullable<ReturnType<typeof parseTap>>): Promise<void>;
        personBack(botId: string, roomId: string, person: Asker): Promise<void>;
    } | undefined;
}

/** A word from the bot's AI is not worth waiting long for: the line falls back to the tool's title. */
const WRITE_TIMEOUT_MS = 4000;

export class NearbyAsks implements NearbySurface, BotAsksPort {
    constructor(private readonly deps: NearbyAsksDeps) {}

    /* ---------------------------------- the surface ---------------------------------- */

    async card(botId: string, spaceName: string, person: Asker, ask: AskField): Promise<void> {
        const bot = this.deps.bot(botId);
        if (!bot || person.playerId === undefined || !bot.inBubble(person.playerId)) throw new Error('The person is not in the bubble');
        if (!bot.sendAskEvent(spaceName, person.playerId, { kind: 'card', id: ask.id, revision: ask.revision, body: JSON.stringify(ask) })) throw new Error('The bot is not in the bubble');
    }

    async reply(botId: string, spaceName: string, person: Asker, text: string, id: string): Promise<void> {
        const bot = this.deps.bot(botId);
        if (!bot || person.playerId === undefined || !bot.inBubble(person.playerId)) return;
        bot.sendAskEvent(spaceName, person.playerId, { kind: 'reply', id, revision: 0, body: text });
    }

    async say(botId: string, spaceName: string, line: string): Promise<void> {
        this.deps.bot(botId)?.sayToBubble(spaceName, line);
    }

    async write(botId: string, system: string, prompt: string): Promise<string | null> {
        try {
            const line = await this.deps.quick(botId, system, prompt, WRITE_TIMEOUT_MS);
            return line || null;
        } catch {
            return null;
        }
    }

    /* ----------------------------------- from the game ----------------------------------- */

    tap(bot: BotClient, spaceName: string, playerId: number, answer: { askId: string; revision: number; tap: string }): void {
        const person = this.askerOf(bot, playerId);
        if (!person) return;
        let tap: unknown;
        try {
            tap = JSON.parse(answer.tap);
        } catch {
            return;
        }
        if (!tap || typeof tap !== 'object') return;
        // Only the card, the revision and what was tapped come in: never content
        const parsed = parseTap({ v: 1, ask: answer.askId, revision: answer.revision, ...(tap as Record<string, unknown>) });
        if (!parsed) return;
        void this.deps.approvals()?.handleTap(bot.getBotId(), spaceName, person, parsed);
    }

    personBack(bot: BotClient, spaceName: string, playerId: number): void {
        // The game says who someone is a moment after they join: wait for it, then show what they had
        const timer = setTimeout(() => {
            const person = this.askerOf(bot, playerId);
            if (person) void this.deps.approvals()?.personBack(bot.getBotId(), spaceName, person);
        }, 1500);
        timer.unref?.();
    }

    /** Who this player is, as the cards know them: signed in, by their uuid. A guest has no cards. */
    private askerOf(bot: BotClient, playerId: number): Asker | null {
        const who = bot.getPersonForArtifacts(playerId);
        if (!who.signedIn || !who.identifier) return null;
        return { uuid: who.identifier, name: who.name, playerId };
    }
}
