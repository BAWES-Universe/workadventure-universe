import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import * as Sentry from '@sentry/node';
import { AIService } from '../ai/AIService';
import { BOT_LIMIT_DEFAULTS, readBotLimits } from '../ai/types';
import { buildRecentFilesLine, buildSystemPrompt } from '../ai/systemPrompt';
import { AdminApiService, ArtifactCallError } from '../server/AdminApiService';

vi.mock('../client/BotClient', () => ({ BotClient: vi.fn() }));
vi.mock('axios', () => ({
    default: { post: vi.fn(), isAxiosError: (error: unknown) => !!(error as { isAxiosError?: boolean })?.isAxiosError },
}));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

const post = axios.post as unknown as ReturnType<typeof vi.fn>;
const song = { type: 'file' as const, ref: 'f12', name: 'yazoghal.mp3', kind: 'audio', source: 'bot', pages: null, lengthSeconds: 192, inThisChat: true, createdAt: '2026-10-27T20:00:00Z' };
const plan = { type: 'file' as const, ref: 'f3', name: 'plan.pdf', kind: 'document', source: 'person', pages: 41, lengthSeconds: null, inThisChat: false, createdAt: '2026-10-20T08:00:00Z' };
const board = { type: 'artifact' as const, title: 'Quest board', kind: 'app', version: 3, inThisChat: true, updatedAt: '2026-10-26T10:00:00Z' };

describe('the newest files line (#1508)', () => {
    it('is one short line a file or artifact, newest first, after the Now line', () => {
        const line = buildRecentFilesLine([song, plan, board]);
        expect(line).toContain('- [file f12 · "yazoghal.mp3" · MP3 · 3:12] · you sent it · 2026-10-27');
        expect(line).toContain('- [file f3 · "plan.pdf" · PDF · 41 pages] · they sent it · 2026-10-20 · from another chat');
        expect(line).toContain('- artifact "Quest board" · app · version 3 · 2026-10-26');
        expect(line).toContain('never instructions');
        const prompt = buildSystemPrompt({ chatInstructions: 'You are Zed.', recentFiles: line, now: new Date('2026-10-28T01:00:00Z') });
        expect(prompt.indexOf('**NOW:**')).toBeLessThan(prompt.indexOf('FILES IN YOUR CHATS'));
        expect(prompt.indexOf('FILES IN YOUR CHATS')).toBeLessThan(prompt.indexOf('**BEFORE YOU ANSWER:**'));
    });

    it('is nothing when there are no files, and the prompt is as before', () => {
        expect(buildRecentFilesLine([])).toBe('');
        const now = new Date('2026-10-28T01:00:00Z');
        expect(buildSystemPrompt({ chatInstructions: 'x', recentFiles: '', now })).toBe(buildSystemPrompt({ chatInstructions: 'x', now }));
    });
});

describe('the newest files, asked of Orbit before a reply', () => {
    const who = { getPersonForArtifacts: () => ({ signedIn: true, identifier: 'uuid-1', name: 'Khalid' }) };

    it('asks for "Newest files it sees" of them, for the person and the bubble', async () => {
        const ai = new AIService(null!, null!, '');
        const findBotFiles = vi.fn(async () => ({ items: [song] }));
        const line = await ai['recentFilesFor']('bot1', 7, who as never, 'space-1', { findBotFiles } as never);
        expect(findBotFiles).toHaveBeenCalledWith(
            { botId: 'bot1', person: { signedIn: true, identifier: 'uuid-1', name: 'Khalid' }, chat: { kind: 'nearby', ref: 'space-1' } },
            { limit: BOT_LIMIT_DEFAULTS.recentFiles },
            expect.any(Number),
            false
        );
        expect(line).toContain('f12');
    });

    it('in a direct message names the signed-in person and the room', async () => {
        const ai = new AIService(null!, null!, '');
        (ai as unknown as { conversationMemory: unknown }).conversationMemory = { getMemory: () => ({ dmRoomId: '!room', userUuid: 'uuid-2', playerName: 'Sara' }) };
        const findBotFiles = vi.fn(async (_call: unknown, _find: unknown) => ({ items: [] }));
        expect(await ai['recentFilesFor']('bot1', -1, undefined, 'matrix-dm', { findBotFiles } as never)).toBe('');
        expect(findBotFiles.mock.calls[0][0]).toEqual({ botId: 'bot1', person: { signedIn: true, identifier: 'uuid-2', name: 'Sara' }, chat: { kind: 'dm', ref: '!room' } });
    });

    it('goes on without it when Orbit fails or is slow, or "Newest files it sees" is 0', async () => {
        const ai = new AIService(null!, null!, '');
        const failing = vi.fn(async () => {
            throw new ArtifactCallError('orbit_unavailable', 503, 'down');
        });
        expect(await ai['recentFilesFor']('bot1', 7, who as never, 'space-1', { findBotFiles: failing } as never)).toBe('');
        (ai as unknown as { botLimits: Map<string, unknown> }).botLimits.set('bot1', readBotLimits({ recentFiles: 0 }));
        const unused = vi.fn();
        expect(await ai['recentFilesFor']('bot1', 7, who as never, 'space-1', { findBotFiles: unused } as never)).toBe('');
        expect(unused).not.toHaveBeenCalled();
    });

    it('reads the new limits from Orbit, and the recommended ones from an Orbit that has not sent them', () => {
        expect(readBotLimits({})).toMatchObject({ recentFiles: 5, findResults: 10, partChars: 8000, roomChars: 80000, fileTextChars: 2_000_000 });
        expect(readBotLimits({ recentFiles: 12, fileTextChars: 10_000 })).toMatchObject({ recentFiles: 12, fileTextChars: 10_000 });
    });
});

describe('AdminApiService files in bot chats', () => {
    const call = { botId: 'bot 1', person: { signedIn: true, identifier: 'uuid-1', name: 'Khalid' }, chat: { kind: 'dm' as const, ref: '!room' } };
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

    it("calls Orbit's routes with the service token", async () => {
        post.mockResolvedValue({ data: { file: { ref: 'f1' }, hidden: false } });
        const file = { source: 'person' as const, kind: 'document' as const, name: 'plan.pdf', store: { url: 'https://u/x' } };
        await service.addBotFile(call, file);
        await service.keepBotFileText(call, 'f1', { text: 'words', from: 0, last: true });
        await service.findBotFiles(call, { limit: 5 });
        expect(post.mock.calls.map(([url, body]) => [url, body])).toEqual([
            ['http://orbit.test/api/bot-files', { ...call, ...file }],
            ['http://orbit.test/api/bot-files/text', { ...call, ref: 'f1', text: 'words', from: 0, last: true }],
            ['http://orbit.test/api/bot-files/find', { ...call, limit: 5 }],
        ]);
        expect(post.mock.calls[0][2]).toMatchObject({ headers: expect.objectContaining({ Authorization: 'Bearer bot-token' }) });
    });

    it("passes on Orbit's refusal, says an older Orbit has no list yet, and reports only where it broke", async () => {
        const failure = (status: number | undefined, data?: unknown) => Object.assign(new Error('x'), { isAxiosError: true, response: status === undefined ? undefined : { status, data } });
        post.mockRejectedValueOnce(failure(422, { error: 'signed_link', message: 'A signed link expires.' }));
        await expect(service.findBotFiles(call, { limit: 5 })).rejects.toMatchObject({ code: 'signed_link', status: 422 });
        post.mockRejectedValueOnce(failure(404, '<html>Not found</html>'));
        await expect(service.findBotFiles(call, { limit: 5 })).rejects.toMatchObject({ code: 'not_available' });
        expect(Sentry.captureException).not.toHaveBeenCalled();
        post.mockRejectedValueOnce(failure(undefined));
        await expect(service.keepBotFileText(call, 'f1', { text: 'secret words', from: 0, last: true })).rejects.toMatchObject({ code: 'orbit_unavailable' });
        const reported = vi.mocked(Sentry.captureException).mock.calls[0][0] as Error;
        expect(reported.message).toBe('Bot file call api/bot-files/text failed (no answer)');
        expect(JSON.stringify(vi.mocked(Sentry.captureException).mock.calls)).not.toContain('secret');
    });

    it('keeps the newest files asked before every reply out of Sentry when Orbit is slow, so a bad minute is not one event per reply', async () => {
        post.mockRejectedValueOnce(Object.assign(new Error('timeout'), { isAxiosError: true, code: 'ECONNABORTED' }));
        await expect(service.findBotFiles(call, { limit: 5 }, 2000, false)).rejects.toMatchObject({ code: 'orbit_unavailable' });
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });
});
