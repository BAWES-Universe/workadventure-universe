import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

vi.mock('../server/BotManager', () => ({ BotManager: class {} }));
vi.mock('../server/BotRegistry', () => ({ BotRegistry: class {} }));
vi.mock('../mcp/MCPConnector', () => ({ MCPConnector: { clearCache: vi.fn() } }));
vi.mock('../utils/MovementLogger', () => ({ movementLogger: {} }));

import { BotAPI } from '../server/BotAPI';

const SESSION = `orb_sess_v2_${'a'.repeat(64)}`;

const botManager = {
    getBot: vi.fn(),
    getRoomState: vi.fn(),
    handlePlayerEnterRoom: vi.fn(),
    spawnBot: vi.fn(),
    despawnBot: vi.fn(),
    updateBot: vi.fn(),
    summonBot: vi.fn(),
};
const adminApiService = {
    validateSessionToken: vi.fn(),
    canSessionManageBot: vi.fn(),
    getBotConfigurations: vi.fn(),
    getAvailableAIProviders: vi.fn(),
    getBotConfiguration: vi.fn(),
    saveBotConfiguration: vi.fn(),
    deleteBotConfiguration: vi.fn(),
};

let server: Server;
let base: string;

beforeAll(async () => {
    const api = new BotAPI(botManager as never, adminApiService as never, {} as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app = (api as any).app;
    server = await new Promise<Server>((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
    vi.clearAllMocks();
    adminApiService.validateSessionToken.mockResolvedValue({ userId: 'u1', uuid: 'uuid-1', email: 'a@b.c' });
    adminApiService.canSessionManageBot.mockResolvedValue(true);
    botManager.getBot.mockReturnValue({});
    botManager.despawnBot.mockResolvedValue(undefined);
    botManager.updateBot.mockResolvedValue({ updated: true, changes: [] });
    botManager.summonBot.mockResolvedValue(undefined);
});

function post(path: string, body: unknown, session?: string) {
    return fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(session ? { Authorization: `Bearer ${session}` } : {}),
        },
        body: JSON.stringify(body),
    });
}

describe('bot server control routes', () => {
    it.each([
        ['/api/bots/spawn', { botId: 'b1', roomId: 'r1' }],
        ['/api/bots/despawn', { botId: 'b1' }],
        ['/api/bots/b1/update', { position: { x: 1, y: 1 } }],
        ['/api/bots/b1/summon', { playerUuid: 'p', playerX: 1, playerY: 1 }],
    ])('refuses %s without an Orbit session', async (path, body) => {
        const response = await post(path, body);
        expect(response.status).toBe(401);
        expect(botManager.despawnBot).not.toHaveBeenCalled();
        expect(botManager.updateBot).not.toHaveBeenCalled();
        expect(botManager.summonBot).not.toHaveBeenCalled();
    });

    it.each([
        ['/api/bots/despawn', { botId: 'b1' }],
        ['/api/bots/b1/update', { position: { x: 1, y: 1 } }],
        ['/api/bots/spawn', { botId: 'b1', roomId: 'r1' }],
    ])('refuses %s when the person cannot manage the bot', async (path, body) => {
        adminApiService.canSessionManageBot.mockResolvedValue(false);
        const response = await post(path, body, SESSION);
        expect(response.status).toBe(403);
        expect(adminApiService.canSessionManageBot).toHaveBeenCalledWith(SESSION, 'b1');
        expect(botManager.despawnBot).not.toHaveBeenCalled();
        expect(botManager.updateBot).not.toHaveBeenCalled();
    });

    it('despawns for a person who can manage the bot', async () => {
        const response = await post('/api/bots/despawn', { botId: 'b1' }, SESSION);
        expect(response.status).toBe(200);
        expect(botManager.despawnBot).toHaveBeenCalledWith('b1');
    });

    it('updates for a person who can manage the bot', async () => {
        const response = await post('/api/bots/b1/update', { position: { x: 1, y: 1 } }, SESSION);
        expect(response.status).toBe(200);
        expect(botManager.updateBot).toHaveBeenCalled();
    });

    it('lets any signed-in person summon without a manager check', async () => {
        const response = await post('/api/bots/b1/summon', { playerUuid: 'p', playerX: 1, playerY: 2 }, SESSION);
        expect(response.status).toBe(200);
        expect(adminApiService.canSessionManageBot).not.toHaveBeenCalled();
        expect(botManager.summonBot).toHaveBeenCalled();
    });

    it('keeps room-enter public', async () => {
        botManager.handlePlayerEnterRoom.mockResolvedValue(undefined);
        const response = await post('/api/bots/room-enter', { roomId: 'r1' });
        expect(response.status).not.toBe(401);
    });

    it('refuses the provider list without a session', async () => {
        const response = await fetch(`${base}/api/bots/ai-providers`);
        expect(response.status).toBe(401);
        expect(adminApiService.getAvailableAIProviders).not.toHaveBeenCalled();
    });

    // Sentry review on this PR: the per-bot routes behind the session check still let any signed-in person act on
    // any bot, with the Admin API token behind them.
    function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
        return fetch(`${base}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SESSION}`, ...headers },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    }

    it.each([
        ['POST', '/api/bots/b1/spawn', undefined],
        ['POST', '/api/bots/b1/despawn', undefined],
        ['PUT', '/api/bots/b1', { name: 'Hijacked' }],
        ['DELETE', '/api/bots/b1', undefined],
        ['GET', '/api/bots/b1', undefined],
        ['GET', '/api/bots/b1/conversations', undefined],
        ['DELETE', '/api/bots/b1/conversations/cleanup', undefined],
        ['GET', '/api/bots/b1/status', undefined],
        ['POST', '/api/bots/test/run-suite', { testSuite: 'basic', botId: 'b1' }],
    ])('refuses %s %s to a signed-in person who cannot manage the bot', async (method, path, body) => {
        adminApiService.canSessionManageBot.mockResolvedValue(false);
        const response = await call(method, path, body);
        expect(response.status).toBe(403);
        expect(adminApiService.canSessionManageBot).toHaveBeenCalledWith(SESSION, 'b1');
        expect(botManager.spawnBot).not.toHaveBeenCalled();
        expect(botManager.despawnBot).not.toHaveBeenCalled();
        expect(adminApiService.getBotConfiguration).not.toHaveBeenCalled();
        expect(adminApiService.saveBotConfiguration).not.toHaveBeenCalled();
        expect(adminApiService.deleteBotConfiguration).not.toHaveBeenCalled();
    });

    it('despawns through the per-bot route for a person who can manage the bot', async () => {
        const response = await call('POST', '/api/bots/b1/despawn');
        expect(response.status).toBe(200);
        expect(botManager.despawnBot).toHaveBeenCalledWith('b1');
    });

    it.each([
        ['POST', '/api/bots', { roomUrl: 'r', behaviorType: 'idle' }],
        ['GET', '/api/bots?roomUrl=r', undefined],
        ['DELETE', '/api/bots/conversations/cleanup', undefined],
        ['POST', '/api/bots/improve/cycle', {}],
        ['POST', '/api/bots/metrics', { metrics: [] }],
    ])('keeps operator tool %s %s from people, even bot managers', async (method, path, body) => {
        process.env.BOT_SERVICE_TOKEN = 'service-secret';
        expect((await call(method, path, body)).status).toBe(403);
        expect((await call(method, path, body, { 'x-bot-service-token': 'wrong' })).status).toBe(403);
        expect(adminApiService.saveBotConfiguration).not.toHaveBeenCalled();
        expect(adminApiService.getBotConfigurations).not.toHaveBeenCalled();
    });

    it('lets an operator with the service token through', async () => {
        process.env.BOT_SERVICE_TOKEN = 'service-secret';
        const response = await call('POST', '/api/bots/metrics', { metrics: [] }, { 'x-bot-service-token': 'service-secret' });
        expect(response.status).not.toBe(403);
    });
});
