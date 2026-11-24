/** Orbit says which purged Bricks still have chats to clear; the bot server clears them and confirms. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
    axios: { get: vi.fn(), post: vi.fn(), isAxiosError: (e: any) => !!e?.isAxiosError },
}));
vi.mock('axios', () => ({ default: hoisted.axios, ...hoisted.axios }));

import { ChatPurgeSweeper } from '../services/ChatPurges';

const base = { adminApiUrl: 'http://orbit.local', botServiceToken: 'service-secret' };

describe('ChatPurgeSweeper', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.axios.get.mockReset();
        hoisted.axios.post.mockReset().mockResolvedValue({ data: {} });
    });

    it('clears each waiting Brick with the service token, then confirms only the ones that are done', async () => {
        hoisted.axios.get.mockResolvedValue({ data: { purges: [{ botId: 'b1' }, { botId: 'b2' }, { botId: 'b3' }] } });
        const purge = vi.fn(async (id: string) => id !== 'b2');
        expect(await new ChatPurgeSweeper({ ...base, purge }).sweep()).toBe(2);
        expect(hoisted.axios.get.mock.calls[0][0]).toBe('http://orbit.local/api/brick-chat-purges');
        expect(hoisted.axios.get.mock.calls[0][1].headers.Authorization).toBe('Bearer service-secret');
        expect(hoisted.axios.get.mock.calls[0][1].params).toBeUndefined();
        expect(purge.mock.calls.map((call) => call[0])).toEqual(['b1', 'b2', 'b3']);
        expect(hoisted.axios.post).toHaveBeenCalledWith('http://orbit.local/api/brick-chat-purges', { botIds: ['b1', 'b3'] }, expect.anything());
    });

    it('counts a purge that throws as not done, and confirms nothing when nothing was done', async () => {
        hoisted.axios.get.mockResolvedValue({ data: { purges: [{ botId: 'b1' }] } });
        expect(await new ChatPurgeSweeper({ ...base, purge: async () => { throw new Error('boom'); } }).sweep()).toBe(0);
        expect(hoisted.axios.post).not.toHaveBeenCalled();
    });

    it('does nothing when none are waiting, and says nothing when Orbit has no such route yet', async () => {
        const purge = vi.fn(async () => true);
        hoisted.axios.get.mockResolvedValue({ data: { purges: [] } });
        expect(await new ChatPurgeSweeper({ ...base, purge }).sweep()).toBe(0);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        hoisted.axios.get.mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
        expect(await new ChatPurgeSweeper({ ...base, purge }).sweep()).toBe(0);
        expect(warn).not.toHaveBeenCalled();
        expect(purge).not.toHaveBeenCalled();
        expect(hoisted.axios.post).not.toHaveBeenCalled();
    });

    it('reads on through every page Orbit lists, so Bricks that cannot be cleared for now never hide the ones behind them', async () => {
        // 150 waiting; the first 100 cannot be cleared (their chat server is down for them): the 50 behind them are still cleared and confirmed
        const all = Array.from({ length: 150 }, (_, i) => `b${String(i).padStart(3, '0')}`);
        hoisted.axios.get.mockImplementation(async (_url: string, options: { params?: { after?: string } }) => {
            const start = options.params?.after ? all.indexOf(options.params.after) + 1 : 0;
            const purges = all.slice(start, start + 100).map((botId) => ({ botId }));
            return { data: { purges, next: purges.length === 100 ? purges[99].botId : null } };
        });
        const purge = vi.fn(async (id: string) => Number(id.slice(1)) >= 100);
        expect(await new ChatPurgeSweeper({ ...base, purge }).sweep()).toBe(50);
        expect(purge).toHaveBeenCalledTimes(150);
        expect(hoisted.axios.get.mock.calls.map((call) => call[1].params?.after)).toEqual([undefined, 'b099']);
        expect(hoisted.axios.post).toHaveBeenCalledTimes(1);
        expect(hoisted.axios.post.mock.calls[0][1].botIds).toEqual(all.slice(100));
    });

    it('confirms each page as it goes, so a page that fails later does not undo the Bricks already cleared', async () => {
        hoisted.axios.get
            .mockResolvedValueOnce({ data: { purges: [{ botId: 'a' }, { botId: 'b' }], next: 'b' } })
            .mockRejectedValueOnce({ isAxiosError: true, response: { status: 500 } });
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await new ChatPurgeSweeper({ ...base, purge: async () => true }).sweep();
        expect(hoisted.axios.post).toHaveBeenCalledWith('http://orbit.local/api/brick-chat-purges', { botIds: ['a', 'b'] }, expect.anything());
    });

    it('takes an Orbit that sends no `next` as the single page it always sent, and stops on a `next` that does not move on', async () => {
        hoisted.axios.get.mockResolvedValue({ data: { purges: [{ botId: 'a' }] } });
        await new ChatPurgeSweeper({ ...base, purge: async () => true }).sweep();
        expect(hoisted.axios.get).toHaveBeenCalledTimes(1);

        hoisted.axios.get.mockReset().mockResolvedValue({ data: { purges: [{ botId: 'a' }], next: 'a' } });
        await new ChatPurgeSweeper({ ...base, purge: async () => false }).sweep();
        // The first page, then the page after 'a', which says 'a' again: the round ends
        expect(hoisted.axios.get).toHaveBeenCalledTimes(2);
    });

    it('does nothing without an Orbit and a token, and never runs two rounds at once', async () => {
        const purge = vi.fn(async () => true);
        const bare = new ChatPurgeSweeper({ ...base, botServiceToken: undefined, purge });
        expect(bare.isConfigured()).toBe(false);
        expect(await bare.sweep()).toBe(0);
        expect(hoisted.axios.get).not.toHaveBeenCalled();

        let release!: () => void;
        hoisted.axios.get.mockImplementation(() => new Promise((resolve) => (release = () => resolve({ data: { purges: [{ botId: 'b1' }] } }))));
        const sweeper = new ChatPurgeSweeper({ ...base, purge });
        const first = sweeper.sweep();
        expect(await sweeper.sweep()).toBe(0);
        release();
        expect(await first).toBe(1);
    });

    it('returns what Orbit already acknowledged when a later page fails', async () => {
        hoisted.axios.get
            .mockResolvedValueOnce({ data: { purges: [{ botId: 'a' }, { botId: 'b' }], next: 'b' } })
            .mockRejectedValueOnce({ isAxiosError: true, response: { status: 500 } });
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(await new ChatPurgeSweeper({ ...base, purge: async () => true }).sweep()).toBe(2);
    });

    it('stops starting Bricks at shutdown, waits for the one under way, and confirms only what finished', async () => {
        hoisted.axios.get.mockResolvedValue({ data: { purges: [{ botId: 'a' }, { botId: 'b' }, { botId: 'c' }] } });
        let finishA!: () => void;
        const purge = vi.fn((id: string) => (id === 'a' ? new Promise<boolean>((resolve) => (finishA = () => resolve(true))) : Promise.resolve(true)));
        const sweeper = new ChatPurgeSweeper({ ...base, purge });
        const round = sweeper.sweep();
        await new Promise((resolve) => setTimeout(resolve, 5));
        const stopping = sweeper.stop(1000);
        finishA();
        await stopping;
        expect(await round).toBe(1);
        // b and c were never started, and nothing new begins after the stop
        expect(purge.mock.calls.map((call) => call[0])).toEqual(['a']);
        expect(hoisted.axios.post).toHaveBeenCalledWith('http://orbit.local/api/brick-chat-purges', { botIds: ['a'] }, expect.anything());
        expect(await sweeper.sweep()).toBe(0);
        sweeper.start();
        expect(hoisted.axios.get).toHaveBeenCalledTimes(1);
    });

    it('does not wait past its grace for a Brick that is slow to clear', async () => {
        hoisted.axios.get.mockResolvedValue({ data: { purges: [{ botId: 'a' }] } });
        const sweeper = new ChatPurgeSweeper({ ...base, purge: () => new Promise<boolean>(() => undefined) });
        void sweeper.sweep();
        await new Promise((resolve) => setTimeout(resolve, 5));
        const started = Date.now();
        await sweeper.stop(30);
        expect(Date.now() - started).toBeLessThan(500);
        expect(hoisted.axios.post).not.toHaveBeenCalled();
    });
});
