import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import * as Sentry from '@sentry/node';
import { AdminApiService, ArtifactCallError } from '../server/AdminApiService';

vi.mock('axios', () => ({
    default: { post: vi.fn(), isAxiosError: (error: unknown) => !!(error as { isAxiosError?: boolean })?.isAxiosError },
}));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

const post = axios.post as unknown as ReturnType<typeof vi.fn>;
const call = { botId: 'bot 1', person: { signedIn: true, identifier: 'uuid-1', name: 'Khalid' }, chat: { kind: 'nearby' as const, ref: 'bubble-1' } };

function axiosFailure(status: number | undefined, data?: unknown) {
    return Object.assign(new Error('request failed'), { isAxiosError: true, response: status === undefined ? undefined : { status, data } });
}

describe('AdminApiService artifacts', () => {
    let service: AdminApiService;

    beforeEach(() => {
        vi.stubEnv('BOT_SERVICE_TOKEN', 'bot-token');
        service = new AdminApiService('http://orbit.test', 'admin-token');
        post.mockReset();
        vi.mocked(Sentry.captureException).mockReset();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('makes an artifact with the service token, naming the bot, the person and the chat', async () => {
        const answer = { artifact: { id: 'a' }, version: { number: 1 }, hidden: false };
        post.mockResolvedValue({ data: answer });
        expect(await service.makeArtifact(call, { title: 'Quests', kind: 'app', content: '<p>x</p>', summary: null })).toBe(answer);
        expect(post).toHaveBeenCalledWith(
            'http://orbit.test/api/artifacts',
            { ...call, title: 'Quests', kind: 'app', content: '<p>x</p>', summary: null },
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer bot-token' }) })
        );
    });

    it('sends songs, images and videos as a form: the same JSON in "request", one "media" part each (#1510)', async () => {
        post.mockResolvedValue({ data: {} });
        await service.makeArtifact(call, { title: 'Song', kind: 'page', content: '<audio src="song.mp3">' }, 5000, [
            { name: 'song.mp3', contentType: 'audio/mpeg', body: new Uint8Array([1, 2, 3]) },
        ]);
        const [, form, options] = post.mock.calls[0];
        expect(form).toBeInstanceOf(FormData);
        expect(JSON.parse((form as FormData).get('request') as string)).toEqual({ ...call, title: 'Song', kind: 'page', content: '<audio src="song.mp3">' });
        const file = (form as FormData).get('media') as File;
        expect([file.name, file.type, file.size]).toEqual(['song.mp3', 'audio/mpeg', 3]);
        // The form sets its own type, with the boundary
        expect(options.headers).not.toHaveProperty('Content-Type');
        expect(options.timeout).toBe(5000);
    });

    it('changes, reads and lists through the routes Orbit has, with the id made safe for the address', async () => {
        post.mockResolvedValue({ data: {} });
        await service.changeArtifact('a/b', call, { edits: [{ old: 'x', new: 'y' }], baseVersion: 2 });
        await service.readArtifact('a b', call, 3);
        await service.readArtifact('a b', call);
        await service.listArtifactsInChat(call);
        expect(post.mock.calls.map(([url]) => url)).toEqual([
            'http://orbit.test/api/artifacts/a%2Fb/change',
            'http://orbit.test/api/artifacts/a%20b/read',
            'http://orbit.test/api/artifacts/a%20b/read',
            'http://orbit.test/api/artifacts/in-chat',
        ]);
        expect(post.mock.calls[0][1]).toEqual({ ...call, edits: [{ old: 'x', new: 'y' }], baseVersion: 2 });
        expect(post.mock.calls[1][1]).toEqual({ ...call, version: 3 });
        expect(post.mock.calls[2][1]).toEqual(call);
    });

    it("passes Orbit's own code and line on when it says no, and reports nothing", async () => {
        post.mockRejectedValue(axiosFailure(422, { error: 'edit_not_found', message: 'Edit 1: the text to replace is not in the file.' }));
        const error = await service.changeArtifact('a', call, { edits: [{ old: 'x', new: 'y' }] }).catch((e) => e);
        expect(error).toBeInstanceOf(ArtifactCallError);
        expect(error).toMatchObject({ code: 'edit_not_found', status: 422, message: 'Edit 1: the text to replace is not in the file.' });
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('says Orbit could not be reached when it errors or does not answer, and reports only where, never the file', async () => {
        post.mockRejectedValueOnce(axiosFailure(500, { error: 'Internal server error' }));
        post.mockRejectedValueOnce(axiosFailure(undefined));
        for (let i = 0; i < 2; i++) {
            const error = await service.makeArtifact(call, { title: 'T', kind: 'app', content: 'SECRET PAGE TEXT' }).catch((e) => e);
            expect(error).toMatchObject({ code: 'orbit_unavailable' });
        }
        expect(Sentry.captureException).toHaveBeenCalledTimes(2);
        for (const [reported] of vi.mocked(Sentry.captureException).mock.calls) {
            expect(String((reported as Error).message)).not.toContain('SECRET');
            expect((reported as Error).message).toContain('api/artifacts');
        }
    });

    it('keeps the line about storage that is not set up', async () => {
        post.mockRejectedValue(axiosFailure(503, { error: 'storage_not_configured', message: 'Artifact storage is not set up on this Orbit.' }));
        await expect(service.makeArtifact(call, { title: 'T', kind: 'app', content: 'x' })).rejects.toMatchObject({ code: 'storage_not_configured' });
    });

    it('does not call Orbit without its address or the service token', async () => {
        await expect(new AdminApiService('', '').makeArtifact(call, { title: 'T', kind: 'app', content: 'x' })).rejects.toMatchObject({ code: 'orbit_unavailable' });
        vi.stubEnv('BOT_SERVICE_TOKEN', '');
        await expect(service.listArtifactsInChat(call)).rejects.toMatchObject({ code: 'orbit_unavailable' });
        expect(post).not.toHaveBeenCalled();
    });
});
