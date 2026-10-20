/**
 * Tests for the check that runs before a bot's AI is reached (game #1158): Orbit decides who may chat with a bot or
 * summon it; the gate keeps its answer for a short while, and never lets anyone through when it cannot ask.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

import * as Sentry from '@sentry/node';
import { ACCESS_CACHE_TTL_MS, BotAccessGate, CANNOT_CHECK_CHAT_LINE } from '../server/BotAccessGate';
import { AdminApiService, type BotAccessAnswer } from '../server/AdminApiService';

const ALLOWED: BotAccessAnswer = { allowed: true, code: 'allowed', reason: null };
const REFUSED: BotAccessAnswer = {
    allowed: false,
    code: 'not_allowed',
    reason: "Nora's owner limits who can chat with it.",
    reply: 'Sorry, I only help the finance team.',
};

const MEMBER = { signedIn: true, identifier: 'mishari@example.test' };
const GUEST = { signedIn: false, identifier: 'guest-uuid' };

function gateWith(checkBotAccess: ReturnType<typeof vi.fn>, configured = true) {
    let clock = 1_000_000;
    const orbit = { isConfigured: () => configured, checkBotAccess } as never;
    const gate = new BotAccessGate(orbit, () => clock);
    return { gate, tick: (ms: number) => (clock += ms) };
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('BotAccessGate', () => {
    it('lets a person Orbit allows through, guests too', async () => {
        const check = vi.fn().mockResolvedValue(ALLOWED);
        const { gate } = gateWith(check);

        expect(await gate.check('b1', 'chat', MEMBER, 'Nora')).toEqual({ allowed: true, kind: 'allowed' });
        expect(await gate.check('b1', 'chat', GUEST, 'Nora')).toEqual({ allowed: true, kind: 'allowed' });
        expect(check).toHaveBeenCalledWith('b1', 'chat', MEMBER);
        expect(check).toHaveBeenCalledWith('b1', 'chat', GUEST);
    });

    it("refuses a chat with the owner's own line when they wrote one", async () => {
        const { gate } = gateWith(vi.fn().mockResolvedValue(REFUSED));

        expect(await gate.check('b1', 'chat', MEMBER, 'Nora')).toEqual({
            allowed: false,
            kind: 'refused',
            code: 'not_allowed',
            line: 'Sorry, I only help the finance team.',
        });
    });

    it("refuses a chat with Orbit's line when the owner wrote none", async () => {
        const withoutReply: BotAccessAnswer = { allowed: false, code: 'not_allowed', reason: REFUSED.reason };
        const { gate } = gateWith(vi.fn().mockResolvedValue(withoutReply));

        const verdict = await gate.check('b1', 'chat', MEMBER, 'Nora');
        expect(verdict).toMatchObject({ allowed: false, kind: 'refused', line: "Nora's owner limits who can chat with it." });
    });

    it('refuses a summon with Orbit\'s line, never the owner\'s chat line', async () => {
        const answer: BotAccessAnswer = {
            allowed: false,
            code: 'not_allowed',
            reason: "Nora's owner limits who can summon it.",
            reply: 'Sorry, I only help the finance team.',
        };
        const { gate } = gateWith(vi.fn().mockResolvedValue(answer));

        const verdict = await gate.check('b1', 'summon', MEMBER, 'Nora');
        expect(verdict).toMatchObject({ allowed: false, kind: 'refused', line: "Nora's owner limits who can summon it." });
    });

    it('asks Orbit once for answers under 30 seconds old, then again', async () => {
        const check = vi.fn().mockResolvedValue(ALLOWED);
        const { gate, tick } = gateWith(check);

        await gate.check('b1', 'chat', MEMBER);
        tick(ACCESS_CACHE_TTL_MS - 1);
        await gate.check('b1', 'chat', MEMBER);
        expect(check).toHaveBeenCalledTimes(1);

        tick(2);
        await gate.check('b1', 'chat', MEMBER);
        expect(check).toHaveBeenCalledTimes(2);
    });

    it("takes the owner's change on the next question after the cache runs out", async () => {
        const check = vi.fn().mockResolvedValueOnce(ALLOWED).mockResolvedValueOnce(REFUSED);
        const { gate, tick } = gateWith(check);

        expect((await gate.check('b1', 'chat', MEMBER)).allowed).toBe(true);
        tick(ACCESS_CACHE_TTL_MS + 1);
        expect(await gate.check('b1', 'chat', MEMBER)).toMatchObject({ allowed: false, kind: 'refused' });
    });

    it('keeps answers apart by bot, action and person, and guests together', async () => {
        const check = vi.fn().mockResolvedValue(ALLOWED);
        const { gate } = gateWith(check);

        await gate.check('b1', 'chat', MEMBER);
        await gate.check('b2', 'chat', MEMBER);
        await gate.check('b1', 'summon', MEMBER);
        await gate.check('b1', 'chat', { signedIn: true, identifier: 'other@example.test' });
        await gate.check('b1', 'chat', GUEST);
        await gate.check('b1', 'chat', { signedIn: false, identifier: 'another-guest' });

        expect(check).toHaveBeenCalledTimes(5);
    });

    it('shares one question between messages sent together', async () => {
        let answer!: (value: BotAccessAnswer) => void;
        const check = vi.fn().mockReturnValue(new Promise<BotAccessAnswer>((resolve) => (answer = resolve)));
        const { gate } = gateWith(check);

        const first = gate.check('b1', 'chat', MEMBER);
        const second = gate.check('b1', 'chat', MEMBER);
        answer(REFUSED);

        expect(await first).toMatchObject({ kind: 'refused' });
        expect(await second).toMatchObject({ kind: 'refused' });
        expect(check).toHaveBeenCalledTimes(1);
    });

    it('uses the last answer for that person when Orbit cannot be reached', async () => {
        const check = vi.fn().mockResolvedValueOnce(ALLOWED).mockRejectedValueOnce(new Error('timeout'));
        const { gate, tick } = gateWith(check);

        await gate.check('b1', 'chat', MEMBER);
        tick(ACCESS_CACHE_TTL_MS * 10);

        expect(await gate.check('b1', 'chat', MEMBER)).toEqual({ allowed: true, kind: 'allowed' });
    });

    it('keeps refusing someone it last refused when Orbit cannot be reached', async () => {
        const check = vi.fn().mockResolvedValueOnce(REFUSED).mockRejectedValueOnce(new Error('timeout'));
        const { gate, tick } = gateWith(check);

        await gate.check('b1', 'chat', MEMBER);
        tick(ACCESS_CACHE_TTL_MS + 1);

        expect(await gate.check('b1', 'chat', MEMBER)).toMatchObject({ allowed: false, kind: 'refused' });
    });

    it('lets nobody through, and says so, when Orbit cannot be reached and there is no earlier answer', async () => {
        const { gate } = gateWith(vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')));

        expect(await gate.check('b1', 'chat', MEMBER, 'Nora')).toEqual({
            allowed: false,
            kind: 'cannot_check',
            line: CANNOT_CHECK_CHAT_LINE,
        });
        expect(await gate.check('b1', 'summon', MEMBER, 'Nora')).toEqual({
            allowed: false,
            kind: 'cannot_check',
            line: "Nora can't check that right now. Try again soon.",
        });
    });

    it('does not remember a failure: the next question asks Orbit again', async () => {
        const check = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(ALLOWED);
        const { gate } = gateWith(check);

        expect((await gate.check('b1', 'chat', MEMBER)).allowed).toBe(false);
        expect((await gate.check('b1', 'chat', MEMBER)).allowed).toBe(true);
    });

    it('reports Orbit being down to Sentry once a minute, not once per message', async () => {
        const { gate, tick } = gateWith(vi.fn().mockRejectedValue(new Error('down')));

        await gate.check('b1', 'chat', MEMBER);
        await gate.check('b1', 'chat', GUEST);
        await gate.check('b1', 'chat', { signedIn: true, identifier: 'x@example.test' });
        expect(Sentry.captureException).toHaveBeenCalledTimes(1);

        tick(60_001);
        await gate.check('b1', 'chat', MEMBER);
        expect(Sentry.captureException).toHaveBeenCalledTimes(2);
    });

    it('refuses and tells Sentry when the bot server has an Orbit address but no BOT_SERVICE_TOKEN', async () => {
        // A broken deploy, not an open door: the server is told where Orbit is, so it must not act as if there were none
        const saved = process.env.BOT_SERVICE_TOKEN;
        delete process.env.BOT_SERVICE_TOKEN;
        try {
            const orbit = new AdminApiService('https://orbit.example.test', 'admin-token');
            const gate = new BotAccessGate(orbit);

            expect(await gate.check('b1', 'summon', GUEST, 'Nora')).toEqual({
                allowed: false,
                kind: 'cannot_check',
                line: "Nora can't check that right now. Try again soon.",
            });
            expect(Sentry.captureException).toHaveBeenCalledTimes(1);
            expect(vi.mocked(Sentry.captureException).mock.calls[0][0]).toEqual(
                new Error('BOT_SERVICE_TOKEN environment variable is not set')
            );
        } finally {
            if (saved === undefined) delete process.env.BOT_SERVICE_TOKEN;
            else process.env.BOT_SERVICE_TOKEN = saved;
        }
    });

    it('asks nobody when the bot server has no Orbit to ask', async () => {
        const check = vi.fn();
        const { gate } = gateWith(check, false);

        expect(await gate.check('b1', 'chat', GUEST)).toEqual({ allowed: true, kind: 'allowed' });
        expect(check).not.toHaveBeenCalled();
    });
});
