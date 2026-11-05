/**
 * Where cards in nearby chat go (#1658): to the person in the bubble who asked, a line to everyone, and taps back from a
 * signed-in person only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NearbyAsks, isBotSpaceUser } from '../NearbyAsks';
import type { AskField } from '../ApprovalCard';

const ASK = { v: 1, kind: 'approval', id: 'act_1', revision: 2, title: 'Send email', lines: [], options: [], expiresAt: 2, now: 1, waitMinutes: 10 } as AskField;
const KHALID = { uuid: 'uuid-khalid', name: 'Khalid', playerId: 7 };

function setup(over: { inBubble?: boolean; signedIn?: boolean; provider?: string | undefined; quick?: () => Promise<string> } = {}) {
    const bot = {
        getBotId: () => 'b1',
        inBubble: vi.fn(() => over.inBubble ?? true),
        sendAskEvent: vi.fn(() => true),
        sayToBubble: vi.fn(() => true),
        getPersonForArtifacts: vi.fn(() => ({ signedIn: over.signedIn ?? true, identifier: over.signedIn === false ? null : 'uuid-khalid', name: 'Khalid' })),
        getFullConfig: () => ({ aiProviderRef: 'provider' in over ? over.provider : 'prov' }),
    };
    const approvals = { handleTap: vi.fn(async () => undefined), personBack: vi.fn(async () => undefined) };
    const quick = vi.fn(over.quick ?? (async () => 'Khalid, I sent the email for you.'));
    const asks = new NearbyAsks({ bot: () => bot as never, quick, approvals: () => approvals });
    return { asks, bot, approvals, quick };
}

afterEach(() => vi.useRealTimers());

describe('the surface', () => {
    it('shows the card to the person in the bubble, as JSON the game reads', async () => {
        const { asks, bot } = setup();
        await asks.card('b1', 'space', KHALID, ASK);
        expect(bot.sendAskEvent).toHaveBeenCalledWith('space', 7, { kind: 'card', id: 'act_1', revision: 2, body: JSON.stringify(ASK) });
    });

    it('throws for a person who is not in the bubble, so no card is shown to nobody', async () => {
        const { asks, bot } = setup({ inBubble: false });
        await expect(asks.card('b1', 'space', KHALID, ASK)).rejects.toThrow();
        expect(bot.sendAskEvent).not.toHaveBeenCalled();
    });

    it('sends a reply to the person alone, and nothing to someone who left', async () => {
        const { asks, bot } = setup();
        await asks.reply('b1', 'space', KHALID, 'Tap Send email.', 'r1');
        expect(bot.sendAskEvent).toHaveBeenCalledWith('space', 7, { kind: 'reply', id: 'r1', revision: 0, body: 'Tap Send email.' });
        const gone = setup({ inBubble: false });
        await gone.asks.reply('b1', 'space', KHALID, 'x', 'r2');
        expect(gone.bot.sendAskEvent).not.toHaveBeenCalled();
    });

    it('says a line to everyone', async () => {
        const { asks, bot } = setup();
        await asks.say('b1', 'space', 'Khalid, I sent the email for you.');
        expect(bot.sayToBubble).toHaveBeenCalledWith('space', 'Khalid, I sent the email for you.');
    });

    it("words a line with the bot's own provider, and is null when that fails, is slow or has no provider", async () => {
        const ok = setup();
        expect(await ok.asks.write('b1', 'system', 'prompt')).toBe('Khalid, I sent the email for you.');
        expect(ok.quick).toHaveBeenCalledWith('b1', 'system', 'prompt', 4000);
        expect(await setup({ quick: async () => '' }).asks.write('b1', 's', 'p')).toBeNull();
        expect(await setup({ quick: async () => { throw new Error('x'); } }).asks.write('b1', 's', 'p')).toBeNull();
    });
});

describe('a tap from the game', () => {
    it('is passed to the cards with only the card, the revision and the tap, for the signed-in person who tapped', () => {
        const { asks, bot, approvals } = setup();
        asks.tap(bot as never, 'space', 7, { askId: 'act_1', revision: 2, tap: '{"action":"decide","option":"approve"}' });
        expect(approvals.handleTap).toHaveBeenCalledWith('b1', 'space', KHALID, { ask: 'act_1', revision: 2, tap: { action: 'decide', option: 'approve' } });
    });

    it('cannot carry anything but a tap: a bad word, bad JSON or extra content does nothing more', () => {
        const { asks, bot, approvals } = setup();
        asks.tap(bot as never, 'space', 7, { askId: 'act_1', revision: 2, tap: 'nope' });
        asks.tap(bot as never, 'space', 7, { askId: 'act_1', revision: 2, tap: '"close"' });
        asks.tap(bot as never, 'space', 7, { askId: 'act_1', revision: 2, tap: '{"action":"deleteEverything"}' });
        asks.tap(bot as never, 'space', 7, { askId: '', revision: 2, tap: '{"action":"close"}' });
        expect(approvals.handleTap).not.toHaveBeenCalled();
        asks.tap(bot as never, 'space', 7, { askId: 'act_1', revision: 2, tap: '{"action":"decide","option":"approve","arguments":{"to":"x"}}' });
        expect(approvals.handleTap).toHaveBeenCalledWith('b1', 'space', KHALID, { ask: 'act_1', revision: 2, tap: { action: 'decide', option: 'approve' } });
    });

    it('takes the card and the revision from the envelope it arrived in, never from the tap itself', () => {
        const { asks, bot, approvals } = setup();
        asks.tap(bot as never, 'space', 7, { askId: 'act_1', revision: 2, tap: '{"v":1,"ask":"act_other","revision":9,"action":"decide","option":"approve"}' });
        expect(approvals.handleTap).toHaveBeenCalledWith('b1', 'space', KHALID, { ask: 'act_1', revision: 2, tap: { action: 'decide', option: 'approve' } });
    });

    it('does nothing for a guest, who has no cards', () => {
        const { asks, bot, approvals } = setup({ signedIn: false });
        asks.tap(bot as never, 'space', 7, { askId: 'act_1', revision: 2, tap: '{"action":"close"}' });
        expect(approvals.handleTap).not.toHaveBeenCalled();
    });
});

describe('a person back in the bubble', () => {
    it('gets their cards a moment later, once the game says who they are', () => {
        vi.useFakeTimers();
        const { asks, bot, approvals } = setup();
        asks.personBack(bot as never, 'space', 7);
        expect(approvals.personBack).not.toHaveBeenCalled();
        vi.advanceTimersByTime(2000);
        expect(approvals.personBack).toHaveBeenCalledWith('b1', 'space', KHALID);
    });

    it('gives a guest nothing', () => {
        vi.useFakeTimers();
        const { asks, bot, approvals } = setup({ signedIn: false });
        asks.personBack(bot as never, 'space', 7);
        vi.advanceTimersByTime(2000);
        expect(approvals.personBack).not.toHaveBeenCalled();
    });
});

describe('who is a bot', () => {
    it('is told by the tag or the uuid the bot token gives', () => {
        expect(isBotSpaceUser({ tags: ['bot'] } as never)).toBe(true);
        expect(isBotSpaceUser({ uuid: 'bot-1', tags: [] } as never)).toBe(true);
        expect(isBotSpaceUser({ uuid: 'u-1', tags: ['member'] } as never)).toBe(false);
    });
});
