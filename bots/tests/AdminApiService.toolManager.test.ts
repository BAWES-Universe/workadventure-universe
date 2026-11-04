import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { AdminApiService } from '../server/AdminApiService';
import { BotAccessGate } from '../server/BotAccessGate';

vi.mock('axios', () => ({ default: { post: vi.fn() } }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

const post = axios.post as unknown as ReturnType<typeof vi.fn>;

describe('AdminApiService.canManageBotTools (game #1656)', () => {
    let service: AdminApiService;

    beforeEach(() => {
        vi.stubEnv('BOT_SERVICE_TOKEN', 'bot-token');
        service = new AdminApiService('http://orbit.test', 'admin-token');
        post.mockReset();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it("asks Orbit who manages the bot's tools with the bot service token", async () => {
        post.mockResolvedValue({ status: 200, data: { canManage: true } });
        expect(await service.canManageBotTools('bot 1', 'sara@example.test')).toBe(true);
        expect(post).toHaveBeenCalledWith(
            'http://orbit.test/api/bots/bot%201/tool-manager',
            { identifier: 'sara@example.test' },
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer bot-token' }) })
        );
    });

    it('answers no for a person Orbit says does not manage it', async () => {
        post.mockResolvedValue({ status: 200, data: { canManage: false } });
        expect(await service.canManageBotTools('b1', 'mishari')).toBe(false);
    });

    it('throws, rather than answering no, when Orbit does not answer or answers something else', async () => {
        post.mockRejectedValueOnce(new Error('down'));
        await expect(service.canManageBotTools('b1', 'sara')).rejects.toThrow('down');
        post.mockResolvedValueOnce({ status: 200, data: { hello: 1 } });
        await expect(service.canManageBotTools('b1', 'sara')).rejects.toThrow('unexpected');
    });

    it('asks the access check about the two permissions a tool may need, and tells a refusal in plain words', async () => {
        post.mockResolvedValue({ status: 200, data: { allowed: false, code: 'not_allowed', reason: null } });
        const gate = new BotAccessGate(service);
        const change = await gate.check('b1', 'change', { signedIn: true, identifier: 'mishari' }, 'Nora');
        const remove = await gate.check('b1', 'deleteOrSend', { signedIn: true, identifier: 'mishari' }, 'Nora');
        expect(change).toMatchObject({ allowed: false, kind: 'refused', line: "You can't have Nora change things here." });
        expect(remove).toMatchObject({ allowed: false, kind: 'refused', line: "You can't have Nora delete or send things here." });
        expect(post).toHaveBeenCalledWith('http://orbit.test/api/bots/b1/access', expect.objectContaining({ action: 'deleteOrSend' }), expect.anything());
    });
});
