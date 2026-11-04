/**
 * QuestionCards: the card a bot shows before a big job when there are real choices (game #1661, mock 5 approved 4 Nov
 * 2026), and what each tap, typed or spoken answer does.
 *
 * Nothing runs when a card is answered: a pick only chooses a direction. The card is kept in this process (a question
 * is not an action Orbit has to arbitrate), the bot's reply ends when it is shown, and the answer comes back to the bot
 * as what the person said, so it carries on with the job. A typed or spoken answer is the same: the card ends as "You
 * answered by typing" or "You answered out loud" and the person's message goes on to the bot as it is.
 *
 * In a bubble the card goes to the person who asked and nobody else; everyone reads one line (the bot needs this
 * person's pick before it does what it was asked), made from the person's name and what the bot said it will do next
 * (#1658, mock 4). After a restart of this process a card on someone's screen ends on its own clock and Review again
 * says the question can't be shown again.
 */
import type { ParsedTap, Tap } from './ApprovalCard';
import { answerText, askLine, buildQuestion, pickedChoices, questionEdit, questionNotice, type QuestionAnswer, type QuestionAsked, type QuestionField } from './QuestionCard';
import { nameForLine } from './NearbyWords';
import type { Asker, CardSurface, NearbySurface } from './ToolApprovals';

const MAX_CARDS = 1000;
/** The card says "No answer" a moment after its time, so the person's own clock is never behind. */
const EXPIRY_GRACE_MS = 1500;

/** What the bot is told when the card is shown: nothing is done yet, the reply ends, the pick comes back as the next message. */
const WAITING_RESULT = {
    status: 'waiting_for_answer',
    message:
        "A card with your question was shown in this chat. Nothing was started. Say in one short line that you need their pick, and nothing else: " +
        'do not start the job, do not ask again and do not call this tool again. Their pick, or what they type instead, comes back as their next message.',
};

/** The same, in a bubble: the line everyone reads is the bot's whole reply, and the choices are for one person only. */
const WAITING_NEARBY_RESULT = {
    status: 'waiting_for_answer',
    message:
        'A card with your question was shown to the person alone, and the chat was told in one line. Nothing was started. ' +
        'Write nothing more: other people can read this chat and the choices are private. Do not call this tool again. Their pick comes back as their next message.',
};

const NO_CARD_RESULT = { error: 'The question card could not be shown, so nothing was asked. Ask in one short sentence in words instead.' };

/** What the bot goes on with after a tap: the pick, as the person's own words. */
export interface QuestionPicked {
    botId: string;
    roomId: string;
    person: Asker;
    nearby: boolean;
    text: string;
}

export interface QuestionDeps {
    /** A direct message's room: the notice carries the card. */
    cards: CardSurface;
    /** A bubble: the card goes to the person alone. Without it a question in a bubble is not asked. */
    nearby?: NearbySurface;
    /** How long a card waits, in minutes (the bot's own setting). */
    waitMinutes(botId: string): Promise<number>;
    /** The person picked: the bot carries on. Never throws. */
    picked(picked: QuestionPicked): Promise<void>;
    now?: () => number;
}

export interface AskInput {
    botId: string;
    roomId: string;
    person: Asker;
    asked: QuestionAsked;
}

export type Asked =
    | { kind: 'waiting'; result: Record<string, unknown>; line?: string }
    | { kind: 'failed'; result: Record<string, unknown> };

interface Card {
    botId: string;
    roomId: string;
    person: Asker;
    nearby: boolean;
    asked: QuestionAsked;
    revision: number;
    expiresAt: number;
    waitMinutes: number;
    /** Not answered, closed or run out. */
    waiting: boolean;
    eventId?: string;
    answer?: QuestionAnswer;
    timer?: ReturnType<typeof setTimeout>;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class QuestionCards {
    private readonly cards = new Map<string, Card>();
    private counter = 0;
    private readonly now: () => number;

    constructor(private readonly deps: QuestionDeps) {
        this.now = deps.now ?? Date.now;
    }

    /** Whether this id is a question card this process holds. */
    owns(id: string): boolean {
        return this.cards.has(id);
    }

    /* ------------------------------------ the card ------------------------------------ */

    /** Shows the card. Never throws. */
    async ask(input: AskInput): Promise<Asked> {
        const { botId, roomId, person, asked } = input;
        const nearby = person.playerId !== undefined;
        if (nearby && !this.deps.nearby) return { kind: 'failed', result: NO_CARD_RESULT };
        // One question card at a time for a person in a chat: the same question again is that card, a different one waits for it
        const open = this.waitingOf(botId, roomId, person, nearby)[0];
        if (open) return { kind: 'waiting', result: nearby ? WAITING_NEARBY_RESULT : WAITING_RESULT };
        try {
            const waitMinutes = Math.max(1, (await this.deps.waitMinutes(botId)) || 10);
            const id = `q-${this.now().toString(36)}-${(this.counter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            const card: Card = { botId, roomId, person, nearby, asked, revision: 1, expiresAt: this.now() + waitMinutes * 60_000, waitMinutes, waiting: true };
            try {
                card.eventId = await this.send(id, card, false);
            } catch (error) {
                console.warn('[QuestionCards] Could not show the question card:', errorText(error));
                return { kind: 'failed', result: NO_CARD_RESULT };
            }
            this.keep(id, card);
            this.schedule(id, card);
            if (!nearby) return { kind: 'waiting', result: WAITING_RESULT };
            return { kind: 'waiting', result: WAITING_NEARBY_RESULT, line: askLine(nameForLine(person.name), asked.before) };
        } catch (error) {
            console.warn('[QuestionCards] Could not ask:', errorText(error));
            return { kind: 'failed', result: NO_CARD_RESULT };
        }
    }

    private fieldOf(id: string, card: Card, answer?: QuestionAnswer): QuestionField {
        return buildQuestion({ ...card.asked, id, revision: card.revision, expiresAt: card.expiresAt, waitMinutes: card.waitMinutes }, this.now(), answer);
    }

    /** Shows the card as it stands, or as it ended: in a direct message the notice (edited in place), in a bubble to the person alone. */
    private async send(id: string, card: Card, edit: boolean): Promise<string> {
        const field = this.fieldOf(id, card, card.answer);
        if (card.nearby) {
            if (!this.deps.nearby) throw new Error('Nearby cards are not set up');
            await this.deps.nearby.card(card.botId, card.roomId, card.person, field);
            return id;
        }
        return this.deps.cards.send(card.botId, card.roomId, edit && card.eventId ? questionEdit(card.eventId, field) : questionNotice(field));
    }

    private async redraw(id: string, card: Card): Promise<void> {
        try {
            if (card.eventId) await this.send(id, card, true);
            else card.eventId = await this.send(id, card, false);
        } catch (error) {
            console.warn(`[QuestionCards] Could not update the card ${id}:`, errorText(error));
        }
    }

    private keep(id: string, card: Card): void {
        this.cards.delete(id);
        this.cards.set(id, card);
        while (this.cards.size > MAX_CARDS) {
            const oldest = this.cards.keys().next().value;
            if (oldest === undefined) break;
            const gone = this.cards.get(oldest);
            clearTimeout(gone?.timer);
            this.cards.delete(oldest);
        }
    }

    private waitingOf(botId: string, roomId: string, person: Asker, nearby: boolean): Card[] {
        return [...this.cards.values()].filter(
            (card) => card.waiting && card.nearby === nearby && card.botId === botId && card.roomId === roomId && card.person.uuid === person.uuid && card.expiresAt > this.now()
        );
    }

    /* ------------------------------------- the clock ------------------------------------- */

    private schedule(id: string, card: Card): void {
        clearTimeout(card.timer);
        const wait = card.expiresAt - this.now() + EXPIRY_GRACE_MS;
        const timer = setTimeout(() => void this.expire(id, card), Math.min(Math.max(wait, 1000), 2 ** 31 - 1));
        timer.unref?.();
        card.timer = timer;
    }

    private async expire(id: string, card: Card): Promise<void> {
        if (!card.waiting || card.expiresAt > this.now()) return;
        card.waiting = false;
        card.answer = { expired: true };
        card.revision += 1;
        await this.redraw(id, card);
    }

    /* -------------------------------------- taps -------------------------------------- */

    /**
     * One tap from the person. True when the card is a question card, whether or not the tap counted: a tap on someone
     * else's card or another chat's does nothing. Never throws.
     */
    async handleTap(botId: string, roomId: string, person: Asker, tap: ParsedTap): Promise<boolean> {
        const id = tap.ask;
        const card = this.cards.get(id);
        if (!card) return false;
        if (card.botId !== botId || card.roomId !== roomId || card.person.uuid !== person.uuid) return true;
        try {
            // Who tapped, as the chat knows them: what the bot says next goes to them
            card.person = { ...card.person, ...person };
            const action: Tap = tap.tap;
            // A tap on a card as it was before it changed: the card is drawn again as it is now, and the tap does not count
            if (tap.revision !== card.revision) {
                await this.redraw(id, card);
                return true;
            }
            switch (action.action) {
                case 'pick':
                    await this.pick(id, card, action.choices);
                    break;
                case 'close':
                    if (!card.waiting) break;
                    card.waiting = false;
                    clearTimeout(card.timer);
                    card.answer = { closed: true };
                    card.revision += 1;
                    await this.redraw(id, card);
                    break;
                case 'moreTime':
                    if (!card.waiting) break;
                    card.expiresAt = this.now() + card.waitMinutes * 60_000;
                    card.revision += 1;
                    this.schedule(id, card);
                    await this.redraw(id, card);
                    break;
                case 'reviewAgain':
                    // Only a card that ended without an answer asks again: a pick, or a typed answer, was answered
                    if (card.waiting || !(card.answer?.expired || card.answer?.closed)) break;
                    if (this.waitingOf(botId, roomId, person, card.nearby).length > 0) break;
                    card.waiting = true;
                    card.answer = undefined;
                    card.expiresAt = this.now() + card.waitMinutes * 60_000;
                    card.revision += 1;
                    this.schedule(id, card);
                    await this.redraw(id, card);
                    break;
                default:
                    break;
            }
            return true;
        } catch (error) {
            console.warn(`[QuestionCards] Could not take the tap on ${id}:`, errorText(error));
            return true;
        }
    }

    private async pick(id: string, card: Card, ids: string[]): Promise<void> {
        if (!card.waiting || card.expiresAt <= this.now()) return;
        const valid = ids.every((choice) => card.asked.choices.some((c) => c.id === choice));
        // One choice unless the question lets more than one tick
        if (!valid || (!card.asked.multiple && ids.length !== 1)) return;
        // Taken before anything is awaited, so two taps at once are one answer
        card.waiting = false;
        clearTimeout(card.timer);
        const field = this.fieldOf(id, card);
        card.answer = { picked: pickedChoices(field, ids).map((choice) => choice.id) };
        card.revision += 1;
        await this.redraw(id, card);
        await this.deps
            .picked({ botId: card.botId, roomId: card.roomId, person: card.person, nearby: card.nearby, text: answerText(field, ids) })
            .catch((error) => console.warn(`[QuestionCards] Could not take the pick on ${id} on to the bot:`, errorText(error)));
    }

    /* ------------------------------- the person writes or speaks ------------------------------- */

    /**
     * The person typed (or said out loud, to a voice bot) something while their card waits: that is their answer, and
     * the card ends as such. Their message goes on to the bot as it is. How many cards ended. Never throws.
     */
    async onPersonMessage(botId: string, roomId: string, person: Asker, how: 'typed' | 'spoken'): Promise<number> {
        const waiting = this.waitingOf(botId, roomId, person, person.playerId !== undefined);
        const ended: Array<[string, Card]> = [];
        for (const card of waiting) {
            const id = [...this.cards.entries()].find(([, held]) => held === card)?.[0];
            if (!id) continue;
            card.waiting = false;
            clearTimeout(card.timer);
            card.answer = how === 'spoken' ? { spoken: true } : { typed: true };
            card.revision += 1;
            ended.push([id, card]);
        }
        for (const [id, card] of ended) await this.redraw(id, card);
        return ended.length;
    }

    /** Whether this person has a question card waiting in this chat: the next thing they say or type answers it. */
    hasWaiting(botId: string, roomId: string, person: Asker): boolean {
        return this.waitingOf(botId, roomId, person, person.playerId !== undefined).length > 0;
    }

    /**
     * The person is in the bubble again (they reloaded, or walked back): their question cards, waiting or ended, come back
     * on their screen. Never throws.
     */
    async personBack(botId: string, roomId: string, person: Asker): Promise<void> {
        for (const [id, card] of this.cards) {
            if (!card.nearby || card.botId !== botId || card.roomId !== roomId || card.person.uuid !== person.uuid) continue;
            try {
                // A card nobody answered in time comes back as it ended
                if (card.waiting && card.expiresAt <= this.now()) {
                    card.waiting = false;
                    card.answer = { expired: true };
                    card.revision += 1;
                }
                card.person = { ...card.person, playerId: person.playerId };
                if (this.deps.nearby) await this.deps.nearby.card(botId, roomId, card.person, this.fieldOf(id, card, card.answer));
            } catch (error) {
                console.warn(`[QuestionCards] Could not show the card ${id} again:`, errorText(error));
            }
        }
    }
}
