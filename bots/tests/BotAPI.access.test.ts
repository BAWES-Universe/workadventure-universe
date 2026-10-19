/**
 * Tests for who may call a bot over, and the question the game asks before it shows Summon (game #1158).
 * Orbit decides; the bot server asks through the gate and never moves a bot for someone it refuses.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

vi.mock('../server/BotManager', () => ({ BotManager: class {} }));
vi.mock('../server/BotRegistry', () => ({ BotRegistry: class {} }));
vi.mock('../mcp/MCPConnector', () => ({ MCPConnector: { clearCache: vi.fn() } }));
vi.mock('../utils/MovementLogger', () => ({ movementLogger: {} }));

import jwt from 'jsonwebtoken';
import { BotAPI } from '../server/BotAPI';

const SESSION = `orb_sess_v2_${'a'.repeat(64)}`;
const SECRET_KEY = 'test-secret-key';
const GAME_TOKEN = jwt.sign({ identifier: 'guest-uuid' }, SECRET_KEY, { expiresIn: '1h' });

const gate = { check: vi.fn() };
const botManager = {
    getBot: vi.fn(),
    getAccessGate: vi.fn(() => gate),
    summonBot: vi.fn(),
};
const adminApiService = {
    validateSessionToken: vi.fn(),
};

let server: Server;
let base: string;

beforeAll(async () => {
    process.env.SECRET_KEY = SECRET_KEY;
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
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    adminApiService.validateSessionToken.mockResolvedValue({ userId: 'u1', uuid: 'uuid-1', email: 'a@b.c' });
    botManager.getBot.mockReturnValue({ getName: () => 'Nora' });
    botManager.summonBot.mockResolvedValue({ x: 40, y: 50 });
    gate.check.mockResolvedValue({ allowed: true, kind: 'allowed' });
});

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
    return fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });
}

const summon = () =>
    post('/api/bots/b1/summon', { playerUuid: 'uuid-1', playerX: 1, playerY: 2 }, { Authorization: `Bearer ${SESSION}` });

describe('Summon', () => {
    it('calls the bot over for a person Orbit allows, and asks as that person', async () => {
        const response = await summon();

        expect(response.status).toBe(200);
        expect(gate.check).toHaveBeenCalledWith('b1', 'summon', { signedIn: true, identifier: 'uuid-1' }, 'Nora');
        expect(botManager.summonBot).toHaveBeenCalledWith('b1', { playerUuid: 'uuid-1' });
    });

    it("refuses a person the owner limited, with Orbit's line, and the bot does not move", async () => {
        gate.check.mockResolvedValue({
            allowed: false,
            kind: 'refused',
            code: 'not_allowed',
            line: "Nora's owner limits who can call it over.",
        });

        const response = await summon();

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
            summoned: false,
            code: 'not_allowed',
            error: "Nora's owner limits who can call it over.",
            reason: "Nora's owner limits who can call it over.",
        });
        expect(botManager.summonBot).not.toHaveBeenCalled();
    });

    it('asks about a guest as a guest, and calls the bot over for one Orbit allows', async () => {
        const response = await post(
            '/api/bots/b1/summon',
            { playerUuid: 'guest-uuid', playerX: 1, playerY: 2 },
            { 'X-WA-Auth': GAME_TOKEN }
        );

        expect(response.status).toBe(200);
        expect(gate.check).toHaveBeenCalledWith('b1', 'summon', { signedIn: false, identifier: undefined }, 'Nora');
        expect(botManager.summonBot).toHaveBeenCalledWith('b1', { playerUuid: 'guest-uuid' });
    });

    it("refuses a guest the owner limited, with the owner's line, and the bot does not move", async () => {
        gate.check.mockResolvedValue({
            allowed: false,
            kind: 'refused',
            code: 'not_allowed',
            line: "Nora's owner limits who can call it over.",
        });

        const response = await post(
            '/api/bots/b1/summon',
            { playerUuid: 'guest-uuid', playerX: 1, playerY: 2 },
            { 'X-WA-Auth': GAME_TOKEN }
        );

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ summoned: false, code: 'not_allowed' });
        expect(botManager.summonBot).not.toHaveBeenCalled();
    });

    it('says it cannot check, and the bot does not move, when Orbit cannot answer', async () => {
        gate.check.mockResolvedValue({
            allowed: false,
            kind: 'cannot_check',
            line: "Nora can't check that right now. Try again soon.",
        });

        const response = await summon();

        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ summoned: false, code: 'cannot_check' });
        expect(botManager.summonBot).not.toHaveBeenCalled();
    });

    it('does not ask Orbit for a bot that is not here', async () => {
        botManager.getBot.mockReturnValue(null);

        const response = await summon();

        expect(response.status).toBe(404);
        expect(gate.check).not.toHaveBeenCalled();
    });
});

describe('May I? (the question the game asks before it shows Summon)', () => {
    it('says yes for an allowed person', async () => {
        const response = await post('/api/bots/b1/access', { action: 'summon' }, { Authorization: `Bearer ${SESSION}` });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ allowed: true });
        expect(gate.check).toHaveBeenCalledWith('b1', 'summon', { signedIn: true, identifier: 'uuid-1' }, 'Nora');
    });

    it('says no, with the line, for a refused person', async () => {
        gate.check.mockResolvedValue({
            allowed: false,
            kind: 'refused',
            code: 'not_allowed',
            line: "Nora's owner limits who can call it over.",
        });

        const response = await post('/api/bots/b1/access', { action: 'summon' }, { Authorization: `Bearer ${SESSION}` });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            allowed: false,
            code: 'not_allowed',
            reason: "Nora's owner limits who can call it over.",
        });
    });

    it('asks about a guest, who has only the game token, as a guest', async () => {
        const response = await post('/api/bots/b1/access', { action: 'summon' }, { 'X-WA-Auth': GAME_TOKEN });

        expect(response.status).toBe(200);
        expect(gate.check).toHaveBeenCalledWith('b1', 'summon', { signedIn: false, identifier: undefined }, 'Nora');
    });

    it('is a 503 when Orbit cannot answer, so the game can tell "no" from "unknown"', async () => {
        gate.check.mockResolvedValue({ allowed: false, kind: 'cannot_check', line: "Nora can't check that right now. Try again soon." });

        const response = await post('/api/bots/b1/access', { action: 'summon' }, { Authorization: `Bearer ${SESSION}` });

        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ code: 'cannot_check' });
    });

    it('turns away someone with no session and no game token', async () => {
        const response = await post('/api/bots/b1/access', { action: 'summon' });

        expect(response.status).toBe(401);
        expect(gate.check).not.toHaveBeenCalled();
    });

    it('does not treat a session Orbit rejects as a guest', async () => {
        adminApiService.validateSessionToken.mockResolvedValue(null);

        const response = await post(
            '/api/bots/b1/access',
            { action: 'summon' },
            { Authorization: `Bearer ${SESSION}`, 'X-WA-Auth': GAME_TOKEN }
        );

        expect(response.status).toBe(401);
        expect(gate.check).not.toHaveBeenCalled();
    });

    it('only answers for the actions the game asks about', async () => {
        const response = await post('/api/bots/b1/access', { action: 'manage' }, { Authorization: `Bearer ${SESSION}` });

        expect(response.status).toBe(400);
        expect(gate.check).not.toHaveBeenCalled();
    });
});
