import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedTap } from '../ApprovalCard';
import { QuestionCards, type QuestionPicked } from '../QuestionCards';
import type { QuestionField } from '../QuestionCard';
import type { Asker } from '../ToolApprovals';

const khalid: Asker = { uuid: 'u-khalid', name: 'Khalid', matrixUserId: '@khalid:chat' };
const sara: Asker = { uuid: 'u-sara', name: 'Sara', matrixUserId: '@sara:chat' };
const asked = {
    question: 'What should the launch party sound like?',
    choices: [
        { id: 'c1', label: 'Upbeat pop', line: '3 tracks, about 3 minutes each' },
        { id: 'c2', label: 'Lo-fi background', line: 'One 20-minute mix' },
        { id: 'c3', label: 'Arabic house' },
    ],
    multiple: false,
    before: 'make the music',
};

function setup(options: { cardFails?: boolean; nearbyMissing?: boolean } = {}) {
    let clock = 1_000_000;
    const sent: Array<Record<string, any>> = [];
    const nearbyCards: Array<{ person: Asker; ask: QuestionField }> = [];
    const picks: QuestionPicked[] = [];
    const cards = new QuestionCards({
        cards: {
            send: async (_bot, _room, content) => {
                if (options.cardFails) throw new Error('no room');
                sent.push(content);
                return `$event${sent.length}`;
            },
            say: async () => undefined,
        },
        ...(options.nearbyMissing
            ? {}
            : {
                  nearby: {
                      card: async (_bot, _space, person, ask) => {
                          if (options.cardFails) throw new Error('not in the bubble');
                          nearbyCards.push({ person, ask: ask as QuestionField });
                      },
                      reply: async () => undefined,
                      say: async () => undefined,
                      write: async () => null,
                  },
              }),
        waitMinutes: async () => 10,
        picked: async (picked) => void picks.push(picked),
        now: () => clock,
    });
    const field = (n = sent.length - 1) => sent[n]['m.new_content']?.['universe.ask'] ?? sent[n]['universe.ask'];
    const tap = (ask: string, revision: number, tap: ParsedTap['tap']): ParsedTap => ({ ask, revision, tap });
    return { cards, sent, nearbyCards, picks, field, tap, advance: (ms: number) => (clock += ms) };
}

const show = async (s: ReturnType<typeof setup>, person: Asker = khalid) => {
    const result = await s.cards.ask({ botId: 'b1', roomId: '!dm', person, asked });
    return result;
};

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => vi.useRealTimers());

describe('showing the card in a direct message', () => {
    it('sends one notice with the question and the choices, and tells the bot to wait', async () => {
        const s = setup();
        const result = await show(s);
        expect(result.kind).toBe('waiting');
        expect(result).toMatchObject({ result: { status: 'waiting_for_answer' } });
        expect(s.sent).toHaveLength(1);
        expect(s.field()).toMatchObject({ kind: 'question', title: asked.question, revision: 1, waitMinutes: 10 });
        expect(s.field().choices).toHaveLength(3);
        expect(s.field().expiresAt - s.field().now).toBe(10 * 60_000);
    });

    it('is one card at a time: asking again while it waits shows nothing new', async () => {
        const s = setup();
        await show(s);
        const again = await show(s);
        expect(again.kind).toBe('waiting');
        expect(s.sent).toHaveLength(1);
    });

    it('tells the bot to ask in words when the card cannot be shown', async () => {
        const s = setup({ cardFails: true });
        const result = await show(s);
        expect(result.kind).toBe('failed');
        expect(JSON.stringify(result.result)).toContain('in words');
        // And nothing waits: the next try shows a card again
        expect(s.cards.hasWaiting('b1', '!dm', khalid)).toBe(false);
    });
});

describe('two questions in the same round', () => {
    it('are one card: the second finds the first still being shown', async () => {
        const s = setup();
        const [first, second] = await Promise.all([show(s), show(s)]);
        expect(s.sent).toHaveLength(1);
        expect(first.kind).toBe('waiting');
        expect(second.kind).toBe('waiting');
    });

    it('asked at the same moment for two different people are two cards', async () => {
        const s = setup();
        await Promise.all([show(s, khalid), show(s, sara)]);
        expect(s.sent).toHaveLength(2);
    });
});

describe('a tap', () => {
    it('picks one choice: the card ends as picked and the bot goes on with the pick as the person said it', async () => {
        const s = setup();
        await show(s);
        const id = s.field().id;
        expect(s.cards.owns(id)).toBe(true);
        expect(await s.cards.handleTap('b1', '!dm', khalid, s.tap(id, 1, { action: 'pick', choices: ['c1'] }))).toBe(true);
        expect(s.sent).toHaveLength(2);
        expect(s.sent[1]['m.relates_to']).toEqual({ rel_type: 'm.replace', event_id: '$event1' });
        expect(s.field()).toMatchObject({ revision: 2, answer: { picked: ['c1'] } });
        expect(s.picks).toHaveLength(1);
        expect(s.picks[0].text).toBe(`My answer to your question "${asked.question}": Upbeat pop (3 tracks, about 3 minutes each). Go ahead with that.`);
        expect(s.picks[0].nearby).toBe(false);
        expect(s.picks[0].person.matrixUserId).toBe('@khalid:chat');
    });

    it('two taps at once are one answer', async () => {
        const s = setup();
        await show(s);
        const id = s.field().id;
        await Promise.all([
            s.cards.handleTap('b1', '!dm', khalid, s.tap(id, 1, { action: 'pick', choices: ['c1'] })),
            s.cards.handleTap('b1', '!dm', khalid, s.tap(id, 1, { action: 'pick', choices: ['c2'] })),
        ]);
        expect(s.picks).toHaveLength(1);
    });

    it('does not count a tap on the card as it was before it changed, and draws the card again as it is', async () => {
        const s = setup();
        await show(s);
        const id = s.field().id;
        await s.cards.handleTap('b1', '!dm', khalid, s.tap(id, 1, { action: 'moreTime' }));
        expect(s.field().revision).toBe(2);
        await s.cards.handleTap('b1', '!dm', khalid, s.tap(id, 1, { action: 'pick', choices: ['c1'] }));
        expect(s.picks).toHaveLength(0);
        expect(s.field()).toMatchObject({ revision: 2 });
        expect(s.field().answer).toBeUndefined();
    });

    it('needs exactly one choice unless the question lets more than one tick', async () => {
        const s = setup();
        await show(s);
        const id = s.field().id;
        await s.cards.handleTap('b1', '!dm', khalid, s.tap(id, 1, { action: 'pick', choices: ['c1', 'c2'] }));
        expect(s.picks).toHaveLength(0);
        await s.cards.handleTap('b1', '!dm', khalid, s.tap(id, 1, { action: 'pick', choices: ['c9' as never] }));
        expect(s.picks).toHaveLength(0);

        const m = setup();
        await m.cards.ask({ botId: 'b1', roomId: '!dm', person: khalid, asked: { ...asked, multiple: true } });
        await m.cards.handleTap('b1', '!dm', khalid, m.tap(m.field().id, 1, { action: 'pick', choices: ['c1', 'c2'] }));
        expect(m.picks[0].text).toContain('Upbeat pop (3 tracks, about 3 minutes each) and Lo-fi background (One 20-minute mix).');
        expect(m.field().answer).toEqual({ picked: ['c1', 'c2'] });
    });

    it("does nothing for someone else's tap or another chat's, and says it is not its own for a card it does not hold", async () => {
        const s = setup();
        await show(s);
        const id = s.field().id;
        await s.cards.handleTap('b1', '!dm', sara, s.tap(id, 1, { action: 'pick', choices: ['c1'] }));
        await s.cards.handleTap('b1', '!other', khalid, s.tap(id, 1, { action: 'pick', choices: ['c1'] }));
        await s.cards.handleTap('b2', '!dm', khalid, s.tap(id, 1, { action: 'pick', choices: ['c1'] }));
        expect(s.picks).toHaveLength(0);
        expect(s.sent).toHaveLength(1);
        expect(await s.cards.handleTap('b1', '!dm', khalid, s.tap('q-unknown', 1, { action: 'pick', choices: ['c1'] }))).toBe(false);
    });

    it('closes with X and nothing goes to the bot', async () => {
        const s = setup();
        await show(s);
        await s.cards.handleTap('b1', '!dm', khalid, s.tap(s.field().id, 1, { action: 'close' }));
        expect(s.field().answer).toEqual({ closed: true });
        expect(s.picks).toHaveLength(0);
    });

    it('gives more time, a full wait from now', async () => {
        const s = setup();
        await show(s);
        s.advance(9 * 60_000);
        await s.cards.handleTap('b1', '!dm', khalid, s.tap(s.field().id, 1, { action: 'moreTime' }));
        expect(s.field().expiresAt - s.field().now).toBe(10 * 60_000);
    });

    it('does not take a pick after the time ran out', async () => {
        const s = setup();
        await show(s);
        const id = s.field().id;
        s.advance(11 * 60_000);
        await s.cards.handleTap('b1', '!dm', khalid, s.tap(id, 1, { action: 'pick', choices: ['c1'] }));
        expect(s.picks).toHaveLength(0);
    });
});

describe('no answer', () => {
    it('ends the card on its own after the wait, and Review again asks the same question again', async () => {
        const s = setup();
        await show(s);
        const id = s.field().id;
        s.advance(10 * 60_000 + 2000);
        await vi.advanceTimersByTimeAsync(10 * 60_000 + 2000);
        expect(s.field().answer).toEqual({ expired: true });
        expect(s.field().revision).toBe(2);
        await s.cards.handleTap('b1', '!dm', khalid, s.tap(id, 2, { action: 'reviewAgain' }));
        expect(s.field().answer).toBeUndefined();
        expect(s.field()).toMatchObject({ revision: 3, title: asked.question });
        // And it can be answered now
        await s.cards.handleTap('b1', '!dm', khalid, s.tap(id, 3, { action: 'pick', choices: ['c2'] }));
        expect(s.picks).toHaveLength(1);
    });

    it('does not ask again for a card that was answered', async () => {
        const s = setup();
        await show(s);
        const id = s.field().id;
        await s.cards.handleTap('b1', '!dm', khalid, s.tap(id, 1, { action: 'pick', choices: ['c1'] }));
        await s.cards.handleTap('b1', '!dm', khalid, s.tap(id, 2, { action: 'reviewAgain' }));
        expect(s.field().answer).toEqual({ picked: ['c1'] });
    });
});

describe('typing or saying something while the card waits', () => {
    it('is the answer: the card says so and the message goes on to the bot as it is', async () => {
        const s = setup();
        await show(s);
        expect(s.cards.hasWaiting('b1', '!dm', khalid)).toBe(true);
        expect(await s.cards.onPersonMessage('b1', '!dm', khalid, 'typed')).toBe(1);
        expect(s.field().answer).toEqual({ typed: true });
        expect(s.picks).toHaveLength(0);
        expect(s.cards.hasWaiting('b1', '!dm', khalid)).toBe(false);
    });

    it('says "out loud" for a spoken answer', async () => {
        const s = setup();
        await show(s);
        await s.cards.onPersonMessage('b1', '!dm', khalid, 'spoken');
        expect(s.field().answer).toEqual({ spoken: true });
    });

    it("never touches someone else's card, and is quiet when no card waits", async () => {
        const s = setup();
        await show(s);
        expect(await s.cards.onPersonMessage('b1', '!dm', sara, 'typed')).toBe(0);
        expect(await s.cards.onPersonMessage('b1', '!elsewhere', khalid, 'typed')).toBe(0);
        expect(s.sent).toHaveLength(1);
    });
});

describe('in nearby chat', () => {
    const bubble: Asker = { ...khalid, playerId: 7 };

    it('shows the card to the person who asked and nobody else, with one line for everyone made from their name and what the bot will do', async () => {
        const s = setup();
        const result = await s.cards.ask({ botId: 'b1', roomId: 'space1', person: bubble, asked });
        expect(s.sent).toHaveLength(0);
        expect(s.nearbyCards).toHaveLength(1);
        expect(s.nearbyCards[0].person.playerId).toBe(7);
        expect(s.nearbyCards[0].ask).toMatchObject({ kind: 'question', title: asked.question });
        expect(result).toMatchObject({ kind: 'waiting', line: 'Khalid, I need your pick before I make the music.' });
        // The line holds nothing from the choices
        expect((result as { line: string }).line).not.toMatch(/pop|lo-fi|house|tracks/i);
        expect(JSON.stringify((result as { result: unknown }).result)).toContain('alone');
    });

    it('goes on with the pick through the bubble, and the card comes back for someone who reloads', async () => {
        const s = setup();
        await s.cards.ask({ botId: 'b1', roomId: 'space1', person: bubble, asked });
        const id = s.nearbyCards[0].ask.id;
        await s.cards.handleTap('b1', 'space1', bubble, s.tap(id, 1, { action: 'pick', choices: ['c3'] }));
        expect(s.picks[0]).toMatchObject({ nearby: true, roomId: 'space1' });
        expect(s.picks[0].person.playerId).toBe(7);
        expect(s.nearbyCards.at(-1)!.ask.answer).toEqual({ picked: ['c3'] });
        await s.cards.personBack('b1', 'space1', { ...khalid, playerId: 9 });
        expect(s.nearbyCards.at(-1)!.person.playerId).toBe(9);
        expect(s.nearbyCards.at(-1)!.ask.answer).toEqual({ picked: ['c3'] });
    });

    it('is not asked when nearby cards are not set up, or the person left the bubble', async () => {
        expect((await setup({ nearbyMissing: true }).cards.ask({ botId: 'b1', roomId: 'space1', person: bubble, asked })).kind).toBe('failed');
        expect((await setup({ cardFails: true }).cards.ask({ botId: 'b1', roomId: 'space1', person: bubble, asked })).kind).toBe('failed');
    });

    it("keeps a direct message's card and a bubble's card apart", async () => {
        const s = setup();
        await show(s);
        await s.cards.ask({ botId: 'b1', roomId: 'space1', person: bubble, asked });
        expect(s.sent).toHaveLength(1);
        expect(s.nearbyCards).toHaveLength(1);
    });
});
