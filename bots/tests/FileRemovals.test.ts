/** Files people deleted from a Brick's list leave the uploader too (game #2003). */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
    axios: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), isAxiosError: (e: any) => !!e?.isAxiosError },
}));
vi.mock('axios', () => ({ default: hoisted.axios, ...hoisted.axios }));

import { FileRemovalSweeper } from '../services/FileRemovals';

const config = { adminApiUrl: 'http://orbit.local', uploaderUrl: 'http://uploader.local', botServiceToken: 'service-secret' };
const gone = { isAxiosError: true, response: { status: 404 } };
const down = { isAxiosError: true, response: { status: 500 } };

describe('FileRemovalSweeper', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.axios.get.mockReset();
        hoisted.axios.post.mockReset().mockResolvedValue({ data: {} });
        hoisted.axios.delete.mockReset().mockResolvedValue({ data: {} });
    });

    it('takes each queued file off the uploader with the service token, then confirms them to Orbit', async () => {
        hoisted.axios.get.mockResolvedValue({ data: { removals: [{ id: 'r1', bucket: 'b', fileId: 'f1.pdf' }, { id: 'r2', bucket: 'b', fileId: 'f2.png' }] } });
        expect(await new FileRemovalSweeper(config).sweep()).toBe(2);
        expect(hoisted.axios.get.mock.calls[0][0]).toBe('http://orbit.local/api/bot-files/removals');
        expect(hoisted.axios.delete.mock.calls.map((call) => call[0])).toEqual(['http://uploader.local/upload-file/f1.pdf', 'http://uploader.local/upload-file/f2.png']);
        expect(hoisted.axios.delete.mock.calls[0][1].headers['x-bot-service-token']).toBe('service-secret');
        expect(hoisted.axios.post).toHaveBeenCalledWith('http://orbit.local/api/bot-files/removals', { ids: ['r1', 'r2'] }, expect.anything());
    });

    it('counts a file the uploader no longer has as done, and keeps one it could not remove for the next round', async () => {
        hoisted.axios.get.mockResolvedValue({ data: { removals: [{ id: 'r1', bucket: 'b', fileId: 'f1' }, { id: 'r2', bucket: 'b', fileId: 'f2' }] } });
        hoisted.axios.delete.mockRejectedValueOnce(gone).mockRejectedValueOnce(down);
        expect(await new FileRemovalSweeper(config).sweep()).toBe(1);
        expect(hoisted.axios.post.mock.calls[0][1]).toEqual({ ids: ['r1'] });
    });

    it('confirms nothing when nothing was removed, and says nothing when Orbit has no such route yet', async () => {
        hoisted.axios.get.mockResolvedValue({ data: { removals: [] } });
        expect(await new FileRemovalSweeper(config).sweep()).toBe(0);
        hoisted.axios.get.mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(await new FileRemovalSweeper(config).sweep()).toBe(0);
        expect(warn).not.toHaveBeenCalled();
        expect(hoisted.axios.post).not.toHaveBeenCalled();
    });

    it('does nothing without an Orbit, an uploader and a token', async () => {
        const sweeper = new FileRemovalSweeper({ ...config, uploaderUrl: undefined });
        expect(sweeper.isConfigured()).toBe(false);
        expect(await sweeper.sweep()).toBe(0);
        expect(hoisted.axios.get).not.toHaveBeenCalled();
    });
});
