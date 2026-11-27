import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIService } from '../ai/AIService';
import { MCPConnector } from '../mcp/MCPConnector';
import { openToolGate } from './helpers/openToolGate';

vi.mock('../client/BotClient', () => ({ BotClient: vi.fn() }));
const uploadAttachmentWithLink = vi.hoisted(() => vi.fn());
vi.mock('../matrix/uploadAttachment', () => ({ uploadAttachmentWithLink, uploadAttachment: vi.fn() }));

/**
 * make_file in the bot server (Brick file tool, 27 Nov): a real .md, .csv or .xlsx goes to the uploader and into the chat as the normal file
 * card, in a bubble and in a direct message, once a turn, and a file request never becomes an app.
 */

const LINK = 'https://files.example/chat-file/bot-gens/0b5c1a6e-3f2d-4c8b-9a71-2e4f6d8c0a1b.xlsx?X-Amz-Signature=abc';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

beforeEach(() => {
    vi.stubEnv('UPLOADER_URL', 'http://uploader.test');
    vi.stubEnv('BOT_SERVICE_TOKEN', 'token');
    vi.stubEnv('BOT_ARTIFACTS_ENABLED', 'true');
    vi.spyOn(MCPConnector, 'discoverToolsWithMapping').mockResolvedValue({ tools: [], toolServerMap: new Map() } as never);
    uploadAttachmentWithLink.mockReset();
    uploadAttachmentWithLink.mockResolvedValue({ location: LINK });
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

function botClient(overrides: Record<string, unknown> = {}) {
    return {
        isInSpace: vi.fn(() => true),
        getPersonForArtifacts: vi.fn(() => ({ signedIn: true, identifier: 'uuid-1', name: 'Khalid' })),
        markStored: vi.fn(),
        sendFile: vi.fn(async () => LINK),
        sendChatMessage: vi.fn(),
        ...overrides,
    };
}

function service(memory?: Record<string, unknown>) {
    const ai = openToolGate(new AIService(null!, null!, ''));
    (ai as unknown as { conversationMemory: unknown }).conversationMemory = { getMemory: () => memory };
    return ai;
}

const sheetCall = (args: Record<string, unknown> = {}, id = 't1') => ({
    id,
    name: 'make_file',
    arguments: JSON.stringify({ name: 'Calendar notes', format: 'xlsx', sheets: [{ name: 'Task', rows: [['a', 'b']] }, { name: 'Vision', rows: [['c']] }], ...args }),
});

describe('make_file in AIService', () => {
    it('is offered in a bubble and in a direct message when the uploader is set up, next to make_artifact, and not otherwise', async () => {
        const ai = openToolGate(new AIService(null!, null!, ''));
        const orbit = { isConfigured: () => true };
        const names = async (client: unknown, channel: 'world' | 'dm') =>
            (await ai['buildTools']('bot1', client as never, orbit as never, channel)).tools.map((tool: { function: { name: string } }) => tool.function.name);
        expect(await names(botClient(), 'world')).toEqual(expect.arrayContaining(['make_file', 'make_artifact']));
        expect(await names(undefined, 'dm')).toEqual(expect.arrayContaining(['make_file', 'make_artifact']));
        // Nowhere to put the file
        expect(await names(undefined, 'world')).not.toContain('make_file');
        // The uploader is not set up here
        vi.stubEnv('UPLOADER_URL', '');
        expect(await names(botClient(), 'world')).not.toContain('make_file');
        expect(await names(undefined, 'dm')).not.toContain('make_file');
    });

    it('tells make_artifact a request for a file is make_file, only while make_file is offered', async () => {
        const ai = openToolGate(new AIService(null!, null!, ''));
        const artifactText = async () =>
            (await ai['buildTools']('bot1', botClient() as never, { isConfigured: () => true } as never, 'world')).tools.find((tool: { function: { name: string } }) => tool.function.name === 'make_artifact').function.description as string;
        expect(await artifactText()).toContain('use make_file instead');
        vi.stubEnv('UPLOADER_URL', '');
        expect(await artifactText()).not.toContain('make_file');
    });

    it('in a bubble: uploads the file, sends it as a file card for the person who asked, and the model is told what it made', async () => {
        const client = botClient();
        const ai = service();
        const [result] = await ai['executeToolCalls']([sheetCall()], client as never, undefined, undefined, 'uuid-1', 'bubble-1', 'bot1', 7);
        expect(uploadAttachmentWithLink).toHaveBeenCalledWith(expect.any(Buffer), XLSX_MIME, 'Calendar notes.xlsx');
        expect(client.markStored).toHaveBeenCalledWith(LINK);
        // The person who asked (7) gets it, with the file's name and type, so it is on their list of files
        expect(client.sendFile).toHaveBeenCalledWith('bubble-1', LINK, 'Calendar notes.xlsx', 7, XLSX_MIME, 7);
        expect(result.result).toEqual({ success: true, name: 'Calendar notes.xlsx', kind: 'Spreadsheet file (.xlsx)', sizeBytes: expect.any(Number), tabs: 2 });
        expect(JSON.stringify(result.result)).not.toContain('https://');
        expect(ai['formatToolResult'](result as never, 'bot1')).toMatch(/a spreadsheet file \(\.xlsx\) with 2 tabs[\s\S]*not a Doc, an app or an artifact/);
        // How it was made goes on the list with the file
        expect(ai.madeFor(LINK)).toEqual({ with: 'make_file', prompt: null });
    });

    it('in a bubble with others reading: the file goes to everyone, and is held back when someone walked up meanwhile', async () => {
        const client = botClient({ othersWith: vi.fn(() => ['uuid-sara', 'uuid-omar']) });
        const [result] = await service()['executeToolCalls']([sheetCall()], client as never, undefined, undefined, 'uuid-1', 'bubble-1', 'bot1', 7, undefined, undefined, false, undefined, undefined, ['uuid-sara']);
        expect(client.sendFile).not.toHaveBeenCalled();
        expect(result.result).toMatchObject({ error: expect.stringMatching(/Someone else just joined/), reason: 'not_sent' });
        const here = botClient({ othersWith: vi.fn(() => ['uuid-sara']) });
        const [sent] = await service()['executeToolCalls']([sheetCall()], here as never, undefined, undefined, 'uuid-1', 'bubble-1', 'bot1', 7, undefined, undefined, false, undefined, undefined, ['uuid-sara']);
        expect(here.sendFile).toHaveBeenCalledWith('bubble-1', LINK, 'Calendar notes.xlsx', 7, XLSX_MIME, undefined, expect.any(Function));
        expect(sent.result).toMatchObject({ success: true });
    });

    it('in a direct message: queues the file with the reply, as a new file that goes on the person\'s list', async () => {
        const memory: Record<string, unknown> = { userUuid: 'uuid-9', playerName: 'Alice', dmRoomId: '!dm:matrix.test', pendingMedia: [] };
        const [result] = await service(memory)['executeToolCalls']([sheetCall({ format: 'md', name: 'Notes', sheets: undefined, content: '# Notes' })], undefined, undefined, undefined, 'uuid-9', 'matrix-dm', 'bot1', -3, undefined, undefined, false, undefined, undefined, undefined, false, false, undefined, 'dm');
        expect(uploadAttachmentWithLink).toHaveBeenCalledWith(expect.any(Buffer), 'text/markdown', 'Notes.md');
        expect(memory.pendingMedia).toEqual([
            { url: LINK, originalUrl: LINK, mediaType: 'file', mimeType: 'text/markdown', caption: 'Notes.md', createdAt: expect.any(Number), retryCount: 0, name: 'Notes.md', audience: -3 },
        ]);
        // A file sent again is marked so it is not listed twice: a new one is not
        expect((memory.pendingMedia as Array<Record<string, unknown>>)[0].again).toBeUndefined();
        expect(result.result).toMatchObject({ success: true, name: 'Notes.md', kind: 'Markdown file (.md)' });
    });

    it('makes a file once a turn however often the model asks, and tries again after a failure', async () => {
        const client = botClient();
        const memory: Record<string, unknown> = {};
        const ai = service(memory);
        const run = () => ai['executeToolCalls']([sheetCall(), sheetCall({}, 't2')], client as never, undefined, undefined, 'uuid-1', 'bubble-1', 'bot1', 7);
        const both = await run();
        expect(uploadAttachmentWithLink).toHaveBeenCalledTimes(1);
        expect(client.sendFile).toHaveBeenCalledTimes(1);
        expect(both[1].result).toEqual(both[0].result);
        // The same turn asked again
        await run();
        expect(client.sendFile).toHaveBeenCalledTimes(1);
        // A different file in the same turn is its own
        await ai['executeToolCalls']([sheetCall({ name: 'Other' }, 't3')], client as never, undefined, undefined, 'uuid-1', 'bubble-1', 'bot1', 7);
        expect(client.sendFile).toHaveBeenCalledTimes(2);

        // A file that could not go may be tried again
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        uploadAttachmentWithLink.mockRejectedValueOnce(new Error('upload 503'));
        const retry = service({});
        const failing = await retry['executeToolCalls']([sheetCall({ name: 'Third' })], client as never, undefined, undefined, 'uuid-1', 'bubble-1', 'bot1', 7);
        expect(failing[0].result).toMatchObject({ reason: 'failed', error: expect.stringContaining('Nothing was sent') });
        const second = await retry['executeToolCalls']([sheetCall({ name: 'Third' })], client as never, undefined, undefined, 'uuid-1', 'bubble-1', 'bot1', 7);
        expect(second[0].result).toMatchObject({ success: true });
        warn.mockRestore();
    });

    it('says plainly when nothing could be made: too big, wrongly asked, a bubble that closed', async () => {
        const client = botClient();
        const [big] = await service()['executeToolCalls']([sheetCall({ format: 'md', sheets: undefined, content: 'a'.repeat(9 * 1024 * 1024) })], client as never, undefined, undefined, 'uuid-1', 'bubble-1', 'bot1', 7);
        expect(big.result).toMatchObject({ reason: 'too_big', error: expect.stringContaining('too big for a chat file') });
        const [wrong] = await service()['executeToolCalls']([sheetCall({ format: 'pptx' })], client as never, undefined, undefined, 'uuid-1', 'bubble-1', 'bot1', 7);
        expect(wrong.result).toMatchObject({ reason: 'invalid' });
        expect(client.sendFile).not.toHaveBeenCalled();
        const closed = botClient({ isInSpace: vi.fn(() => false) });
        const [gone] = await service()['executeToolCalls']([sheetCall()], closed as never, undefined, undefined, 'uuid-1', 'bubble-1', 'bot1', 7);
        expect(gone.result).toMatchObject({ error: expect.stringMatching(/conversation ended/) });
        expect(closed.sendFile).not.toHaveBeenCalled();
        const thrown = botClient({ sendFile: vi.fn(async () => { throw new Error('send failed'); }) });
        const [broken] = await service()['executeToolCalls']([sheetCall()], thrown as never, undefined, undefined, 'uuid-1', 'bubble-1', 'bot1', 7);
        expect(broken.result).toMatchObject({ error: expect.stringMatching(/couldn't be sent right now/) });
    });

    it('is not run when the uploader is not set up here, even if the model asks for it', async () => {
        vi.stubEnv('BOT_SERVICE_TOKEN', '');
        const client = botClient();
        await service()['executeToolCalls']([sheetCall()], client as never, undefined, undefined, 'uuid-1', 'bubble-1', 'bot1', 7);
        expect(uploadAttachmentWithLink).not.toHaveBeenCalled();
        expect(client.sendFile).not.toHaveBeenCalled();
    });
});
