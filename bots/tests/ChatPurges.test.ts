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
});
