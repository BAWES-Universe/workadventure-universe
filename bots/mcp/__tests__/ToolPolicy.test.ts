/**
 * Tests for the reader of Orbit's tool policy (game #1656): how it parses an answer, keeps it for a few seconds, shares
 * one question between calls, and what it does when Orbit can't be asked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));

import axios from 'axios';
import { POLICY_FRESH_MS, POLICY_STALE_OK_MS, ToolPolicySource, ToolPolicyUnavailable, parseServerPolicy } from '../ToolPolicy';

const get = vi.mocked(axios.get);
const ORBIT = { adminApiUrl: 'https://orbit.test', adminApiToken: 'admin-token' };

const answer = (overrides: Record<string, unknown> = {}) => ({
    data: {
        serverId: 's1',
        state: 'confirmed',
        policyRevision: 4,
        settings: { looksUp: 'rightAway', makesNew: 'rightAway', changesThings: 'asksFirst', deletesOrSends: 'off' },
        tools: [
            { id: 't1', name: 'search', fingerprint: 'fp-1', heading: 'looksUp', suggestedHeading: 'looksUp', state: 'confirmed' },
            { id: 't2', name: 'remove', fingerprint: 'fp-2', heading: null, suggestedHeading: 'deletesOrSends', state: 'notConfirmedYet' },
        ],
        ...overrides,
    },
});

function sourceAt(clock: { now: number }, orbit: typeof ORBIT | null = ORBIT) {
    return new ToolPolicySource(() => orbit, () => clock.now);
}

beforeEach(() => {
    get.mockReset();
});

describe('parseServerPolicy', () => {
    it('reads the state, revision, settings and each tool', () => {
        const policy = parseServerPolicy('s1', answer().data)!;
        expect(policy.state).toBe('confirmed');
        expect(policy.policyRevision).toBe(4);
        expect(policy.settings.deletesOrSends).toBe('off');
        expect(policy.tools.get('search')).toEqual({ name: 'search', fingerprint: 'fp-1', heading: 'looksUp', suggestedHeading: 'looksUp', confirmed: true });
        expect(policy.tools.get('remove')).toMatchObject({ heading: null, suggestedHeading: 'deletesOrSends', confirmed: false });
    });

    it('reads a setting it does not know as asks first, the stricter reading', () => {
        const policy = parseServerPolicy('s1', answer({ settings: { looksUp: 'whenever' } }).data)!;
        expect(policy.settings).toEqual({ looksUp: 'asksFirst', makesNew: 'asksFirst', changesThings: 'asksFirst', deletesOrSends: 'asksFirst' });
    });

    it('skips a tool without a name or fingerprint, and a heading it does not know', () => {
        const policy = parseServerPolicy('s1', answer({ tools: [{ name: 'a' }, { fingerprint: 'x' }, { name: 'b', fingerprint: 'y', heading: 'does-everything', state: 'confirmed' }] }).data)!;
        expect([...policy.tools.keys()]).toEqual(['b']);
        expect(policy.tools.get('b')!.heading).toBeNull();
    });

    it('is nothing for an answer that is not a policy', () => {
        expect(parseServerPolicy('s1', null)).toBeNull();
        expect(parseServerPolicy('s1', { state: 'soon', policyRevision: 1, tools: [] })).toBeNull();
        expect(parseServerPolicy('s1', { state: 'confirmed', tools: [] })).toBeNull();
    });
});

describe('ToolPolicySource', () => {
    it('asks Orbit for the bot and server with the admin token', async () => {
        get.mockResolvedValue(answer());
        await sourceAt({ now: 1 }).read('bot 1', 's1');
        expect(get).toHaveBeenCalledWith('https://orbit.test/api/bots/bot%201/mcp-servers/s1/tools', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer admin-token' }) }));
    });

    it('uses a fresh answer without asking again, and asks again once it is old', async () => {
        get.mockResolvedValue(answer());
        const clock = { now: 1_000 };
        const source = sourceAt(clock);
        await source.read('b', 's1');
        clock.now += POLICY_FRESH_MS - 1;
        await source.read('b', 's1');
        expect(get).toHaveBeenCalledTimes(1);
        clock.now += 2;
        await source.read('b', 's1');
        expect(get).toHaveBeenCalledTimes(2);
    });

    it('shares one question between calls made together', async () => {
        get.mockResolvedValue(answer());
        const source = sourceAt({ now: 1 });
        await Promise.all([source.read('b', 's1'), source.read('b', 's1'), source.read('b', 's1')]);
        expect(get).toHaveBeenCalledTimes(1);
    });

    it('keeps each bot and server apart', async () => {
        get.mockResolvedValue(answer());
        const source = sourceAt({ now: 1 });
        await source.read('b1', 's1');
        await source.read('b2', 's1');
        await source.read('b1', 's2');
        expect(get).toHaveBeenCalledTimes(3);
    });

    it('lets the last answer stand for a while when Orbit can not be asked, and not after', async () => {
        const clock = { now: 1_000 };
        const source = sourceAt(clock);
        get.mockResolvedValueOnce(answer());
        const first = await source.read('b', 's1');

        get.mockRejectedValue(new Error('down'));
        clock.now += POLICY_FRESH_MS + 1;
        expect(await source.read('b', 's1')).toBe(first);

        clock.now += POLICY_STALE_OK_MS;
        await expect(source.read('b', 's1')).rejects.toBeInstanceOf(ToolPolicyUnavailable);
    });

    it('can not be read at all with no earlier answer', async () => {
        get.mockRejectedValue(new Error('down'));
        await expect(sourceAt({ now: 1 }).read('b', 's1')).rejects.toBeInstanceOf(ToolPolicyUnavailable);
    });

    it('can not be read without an Orbit to ask', async () => {
        await expect(sourceAt({ now: 1 }, null).read('b', 's1')).rejects.toBeInstanceOf(ToolPolicyUnavailable);
        expect(get).not.toHaveBeenCalled();
    });

    it('does not keep an answer that is not a policy', async () => {
        get.mockResolvedValue({ data: { hello: 'world' } });
        await expect(sourceAt({ now: 1 }).read('b', 's1')).rejects.toBeInstanceOf(ToolPolicyUnavailable);
    });

    it('asks again at once after forget', async () => {
        get.mockResolvedValue(answer());
        const source = sourceAt({ now: 1 });
        await source.read('b', 's1');
        source.forget('b', 's1');
        await source.read('b', 's1');
        expect(get).toHaveBeenCalledTimes(2);
    });
});
