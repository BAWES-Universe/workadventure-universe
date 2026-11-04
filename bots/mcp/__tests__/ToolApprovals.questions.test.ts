import { describe, expect, it, vi } from 'vitest';
import { ToolApprovals, type Asker } from '../ToolApprovals';
import { QuestionCards } from '../QuestionCards';
import { DEFAULT_CARD_SETTINGS } from '../OrbitActions';

const person: Asker = { uuid: 'u1', name: 'Khalid', matrixUserId: '@k:chat' };
const asked = { question: 'Which style?', choices: [{ id: 'c1', label: 'Pop' }, { id: 'c2', label: 'Lo-fi' }], multiple: false };

function setup() {
    const sent: Array<Record<string, any>> = [];
    const picks: string[] = [];
    const said: string[] = [];
    const orbit = {
        cardSettings: vi.fn(async () => ({ ...DEFAULT_CARD_SETTINGS, askWhichWay: 'beforeBiggerJobs' as const })),
        touchGrants: vi.fn(async () => undefined),
        supersede: vi.fn(async () => [] as string[]),
        read: vi.fn(async () => null),
    };
    const questions = new QuestionCards({
        cards: { send: async (_b, _r, content) => (sent.push(content), `$e${sent.length}`), say: async () => undefined },
        waitMinutes: async () => 10,
        picked: async ({ text }) => void picks.push(text),
    });
    const approvals = new ToolApprovals({
        orbit: orbit as never,
        cards: { send: async () => '$x', say: async (_b, _r, text) => void said.push(text) },
        gate: { decide: async () => ({ kind: 'run' as const }) },
        tools: { find: async () => null, run: async () => undefined },
        questions,
    });
    const field = () => sent.at(-1)!['m.new_content']?.['universe.ask'] ?? sent.at(-1)!['universe.ask'];
    return { approvals, orbit, sent, picks, said, field };
}

describe('question cards through ToolApprovals', () => {
    it('shows a card and reads the bot settings from Orbit', async () => {
        const s = setup();
        expect(s.approvals.asksQuestions).toBe(true);
        expect((await s.approvals.settings('b1')).askWhichWay).toBe('beforeBiggerJobs');
        expect((await s.approvals.askQuestion({ botId: 'b1', roomId: '!dm', person, asked })).kind).toBe('waiting');
        expect(s.field().kind).toBe('question');
    });

    it('gives the recommended settings when Orbit cannot be asked', async () => {
        const s = setup();
        s.orbit.cardSettings.mockRejectedValue(new Error('down'));
        expect(await s.approvals.settings('b1')).toEqual(DEFAULT_CARD_SETTINGS);
    });

    it('hands a pick to the question card and never to Orbit', async () => {
        const s = setup();
        await s.approvals.askQuestion({ botId: 'b1', roomId: '!dm', person, asked });
        await s.approvals.handleTap('b1', '!dm', person, { ask: s.field().id, revision: 1, tap: { action: 'pick', choices: ['c2'] } });
        expect(s.picks).toHaveLength(1);
        expect(s.orbit.read).not.toHaveBeenCalled();
    });

    it('tells the person when a card it no longer holds is tapped, without asking Orbit for an action', async () => {
        const s = setup();
        await s.approvals.handleTap('b1', '!dm', person, { ask: 'q-gone', revision: 1, tap: { action: 'pick', choices: ['c1'] } });
        await s.approvals.handleTap('b1', '!dm', person, { ask: 'q-gone', revision: 1, tap: { action: 'reviewAgain' } });
        expect(s.orbit.read).not.toHaveBeenCalled();
        expect(s.sent).toHaveLength(0);
        expect(s.said).toEqual(['That question is no longer open. Ask me again.', 'That question is no longer open. Ask me again.']);
    });

    it('answers a waiting question when the person writes in the chat, and still looks after approval cards', async () => {
        const s = setup();
        await s.approvals.askQuestion({ botId: 'b1', roomId: '!dm', person, asked });
        await s.approvals.onPersonMessage('b1', '!dm', person);
        expect(s.field().answer).toEqual({ typed: true });
        expect(s.orbit.supersede).toHaveBeenCalledTimes(1);
    });

    it('answers a question out loud in a bubble', async () => {
        const s = setup();
        const bubble: Asker = { ...person, playerId: 4 };
        const nearby = { card: vi.fn(async () => undefined), reply: async () => undefined, say: async () => undefined, write: async () => null };
        const questions = new QuestionCards({ cards: { send: async () => '$x', say: async () => undefined }, nearby, waitMinutes: async () => 10, picked: async () => undefined });
        const approvals = new ToolApprovals({ orbit: s.orbit as never, cards: { send: async () => '$x', say: async () => undefined }, nearby, gate: { decide: async () => ({ kind: 'run' as const }) }, tools: { find: async () => null, run: async () => undefined }, questions });
        await approvals.askQuestion({ botId: 'b1', roomId: 'space1', person: bubble, asked });
        expect(await approvals.answerQuestionByMessage('b1', 'space1', bubble, 'spoken')).toBe(true);
        expect((nearby.card.mock.calls.at(-1) as unknown as [string, string, Asker, { answer: object }])[3].answer).toEqual({ spoken: true });
        expect(await approvals.answerQuestionByMessage('b1', 'space1', bubble, 'spoken')).toBe(false);
    });

    it('is not set up without question cards', async () => {
        const approvals = new ToolApprovals({ orbit: { cardSettings: async () => DEFAULT_CARD_SETTINGS } as never, cards: { send: async () => '$x', say: async () => undefined }, gate: { decide: async () => ({ kind: 'run' as const }) }, tools: { find: async () => null, run: async () => undefined } });
        expect(approvals.asksQuestions).toBe(false);
        expect((await approvals.askQuestion({ botId: 'b1', roomId: '!dm', person, asked })).kind).toBe('failed');
    });
});
