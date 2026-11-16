/**
 * What the bot server asks Orbit for a reply other people in the bubble or meeting room read too (game #1993): that it
 * is one, and for files who else is there. Orbit then answers with only what all of them may see.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { AdminApiService, ArtifactCallError, isUnknownField, reachFor } from '../server/AdminApiService';
import { SOMEONE_UNKNOWN } from '../memory/Heard';

vi.mock('axios', () => ({
    default: { post: vi.fn(), isAxiosError: (error: unknown) => !!(error as { isAxiosError?: boolean })?.isAxiosError },
}));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

const post = axios.post as unknown as ReturnType<typeof vi.fn>;
const call = { botId: 'bot1', person: { signedIn: true, identifier: 'uuid-khalid', name: 'Khalid' }, chat: { kind: 'nearby' as const, ref: 'bubble-1' } };
const SONG = { kind: 'audio', name: 'song.mp3', source: 'person' as const, store: { url: 'https://cdn.example.test/song.mp3' } };

function refused(status: number, error: string) {
    return Object.assign(new Error('request failed'), { isAxiosError: true, response: { status, data: { error } } });
}

describe('reachFor: who reads a reply, as Orbit takes it', () => {
    it('says nothing when the person is alone with the bot', () => {
        expect(reachFor(undefined)).toEqual({});
    });

    it('says the reply is one other people read, and who else is there', () => {
        expect(reachFor(['uuid-sara', 'uuid-omar'])).toEqual({ everyoneHere: true, others: ['uuid-sara', 'uuid-omar'] });
        // Someone the bot cannot name stays in the list: Orbit then uses no file
        expect(reachFor([SOMEONE_UNKNOWN])).toEqual({ everyoneHere: true, others: [SOMEONE_UNKNOWN] });
        // Nobody named at all is no name to check either
        expect(reachFor([])).toEqual({ everyoneHere: true, others: [] });
    });

    it('names nobody when there are more people, or a longer id, than Orbit takes: no file is used then', () => {
        const crowd = Array.from({ length: 201 }, (_, i) => `uuid-${i}`);
        expect(reachFor(crowd)).toEqual({ everyoneHere: true, others: [SOMEONE_UNKNOWN] });
        expect(reachFor(crowd.slice(0, 200)).others).toHaveLength(200);
        expect(reachFor(['uuid-sara', 'x'.repeat(321)])).toEqual({ everyoneHere: true, others: [SOMEONE_UNKNOWN] });
    });
});

describe('isUnknownField: an Orbit from before a field existed', () => {
    it('is its refusal of a body it does not know, and nothing else', () => {
        expect(isUnknownField(new ArtifactCallError('Invalid request data', 400, 'Invalid request data'))).toBe(true);
        expect(isUnknownField(new ArtifactCallError('not_found', 404, 'Not found'))).toBe(false);
        expect(isUnknownField(new ArtifactCallError('Invalid request data', 500, 'Invalid request data'))).toBe(false);
        expect(isUnknownField(new Error('Invalid request data'))).toBe(false);
    });
});

describe('AdminApiService: a reply other people read', () => {
    let service: AdminApiService;

    beforeEach(() => {
        vi.stubEnv('BOT_SERVICE_TOKEN', 'bot-token');
        service = new AdminApiService('http://orbit.test', 'admin-token');
        post.mockReset();
    });
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    const bodies = () => post.mock.calls.map(([url, body]) => ({ url: String(url).replace('http://orbit.test/', ''), body }));

    it('keeps a file with everyone else who was there when it was sent', async () => {
        post.mockResolvedValue({ data: { file: { ref: 'f1' }, hidden: false } });
        await service.addBotFile(call, { ...SONG, others: ['uuid-sara'] } as never);

        expect(bodies()).toEqual([{ url: 'api/bot-files', body: { ...call, ...SONG, others: ['uuid-sara'] } }]);
    });

    it('names nobody when nobody else was there', async () => {
        post.mockResolvedValue({ data: { file: { ref: 'f1' }, hidden: false } });
        await service.addBotFile(call, { ...SONG, others: [] } as never);
        await service.addBotFile(call, SONG as never);

        expect(bodies().map((sent) => sent.body)).toEqual([{ ...call, ...SONG }, { ...call, ...SONG }]);
    });

    it('still keeps the file with an Orbit from before: without the others, so it stays with its person', async () => {
        post.mockRejectedValueOnce(refused(400, 'Invalid request data')).mockResolvedValueOnce({ data: { file: { ref: 'f1' }, hidden: false } });
        const kept = await service.addBotFile(call, { ...SONG, others: ['uuid-sara'] } as never);

        expect(kept).toEqual({ file: { ref: 'f1' }, hidden: false });
        expect(bodies().map((sent) => sent.body)).toEqual([{ ...call, ...SONG, others: ['uuid-sara'] }, { ...call, ...SONG }]);
    });

    it('does not try again for any other refusal', async () => {
        post.mockRejectedValue(refused(403, 'bot_not_allowed'));
        await expect(service.addBotFile(call, { ...SONG, others: ['uuid-sara'] } as never)).rejects.toMatchObject({ code: 'bot_not_allowed' });
        expect(post).toHaveBeenCalledTimes(1);
    });

    it('finds, gets and reads a file saying who else is there', async () => {
        post.mockResolvedValue({ data: {} });
        const reach = { ...call, ...reachFor(['uuid-sara']) };
        await service.findBotFiles(reach, { limit: 5 });
        await service.getBotFile(reach, 'f1');
        await service.readBotFile(reach, { ref: 'f1', chars: 2000 });

        expect(bodies()).toEqual([
            { url: 'api/bot-files/find', body: expect.objectContaining({ ...call, everyoneHere: true, others: ['uuid-sara'], limit: 5 }) },
            { url: 'api/bot-files/get', body: { ...call, everyoneHere: true, others: ['uuid-sara'], ref: 'f1' } },
            { url: 'api/bot-files/read', body: { ...call, everyoneHere: true, others: ['uuid-sara'], ref: 'f1', chars: 2000 } },
        ]);
    });

    it('asks as before when the person is alone with the bot', async () => {
        post.mockResolvedValue({ data: {} });
        await service.getBotFile({ ...call, ...reachFor(undefined) }, 'f1');
        await service.listArtifactsInChat(call);
        await service.readArtifact('a1', call);

        expect(bodies().map((sent) => sent.body)).toEqual([{ ...call, ref: 'f1' }, call, call]);
    });

    it('lists, reads and changes artifacts saying other people read the reply', async () => {
        post.mockResolvedValue({ data: {} });
        await service.listArtifactsInChat({ ...call, everyoneHere: true });
        await service.readArtifact('a1', { ...call, everyoneHere: true, referencedArtifactIds: ['a1'] });
        await service.changeArtifact('a1', { ...call, everyoneHere: true }, { content: '<p>two</p>' });

        expect(bodies()).toEqual([
            { url: 'api/artifacts/in-chat', body: { ...call, everyoneHere: true } },
            { url: 'api/artifacts/a1/read', body: { ...call, everyoneHere: true, referencedArtifactIds: ['a1'] } },
            { url: 'api/artifacts/a1/change', body: { ...call, everyoneHere: true, content: '<p>two</p>' } },
        ]);
    });

    it('never sends it where Orbit takes only who and where: making an artifact, adding a file, keeping its text', async () => {
        post.mockResolvedValue({ data: {} });
        const reach = { ...call, ...reachFor(['uuid-sara']) };
        await service.makeArtifact(reach, { title: 'Budget', kind: 'page', content: '<p>x</p>' });
        await service.addBotFile(reach, SONG as never);
        await service.keepBotFileText(reach, 'f1', { text: 'words', at: 0, last: true } as never);
        await service.listArtifactsInChat(reach);

        for (const sent of bodies()) {
            expect(sent.body).not.toHaveProperty('others');
            if (sent.url !== 'api/artifacts/in-chat') expect(sent.body).not.toHaveProperty('everyoneHere');
        }
    });
});
