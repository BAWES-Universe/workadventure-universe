/**
 * Tests for calling a bot (game #2004): only for yourself, only when Orbit's "Call" rule says yes, and the bot then
 * opens its call-only connection and answers with the space to join.
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
import { BotCannotCallError, BotUnavailableError } from '../utils/summonErrors';

const SESSION = `orb_sess_v2_${'a'.repeat(64)}`;
const SECRET_KEY = 'test-secret-key';
const GAME_TOKEN = jwt.sign({ identifier: 'guest-uuid' }, SECRET_KEY, { expiresIn: '1h' });

const gate = { check: vi.fn() };
const botManager = {
    getBot: vi.fn(),
    getAccessGate: vi.fn(() => gate),
    startCall: vi.fn(),
    endCall: vi.fn(),
    canTakeCall: vi.fn(),
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
    botManager.startCall.mockResolvedValue({ spaceName: 'call__abc' });
    botManager.endCall.mockResolvedValue(true);
    botManager.canTakeCall.mockResolvedValue(true);
    gate.check.mockResolvedValue({ allowed: true, kind: 'allowed' });
});

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
    return fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });
}


const auth = { Authorization: `Bearer ${SESSION}` };
const call = (body: unknown = { playerUuid: 'uuid-1' }, headers: Record<string, string> = auth) => post('/api/bots/b1/call', body, headers);

describe('Call', () => {
    it('starts the call for a person Orbit allows, asking as that person, and answers with the space to join', async () => {
        const response = await call();
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ botId: 'b1', started: true, spaceName: 'call__abc' });
        expect(gate.check).toHaveBeenCalledWith('b1', 'call', { signedIn: true, identifier: 'uuid-1' }, 'Nora');
        expect(botManager.startCall).toHaveBeenCalledWith('b1', 'uuid-1');
    });

    it('does not start a call Orbit refuses, and says why in its own line', async () => {
        gate.check.mockResolvedValue({ allowed: false, kind: 'refused', code: 'not_allowed', line: 'Nora does not take calls.' });
        const response = await call();
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ started: false, code: 'not_allowed', reason: 'Nora does not take calls.' });
        expect(botManager.startCall).not.toHaveBeenCalled();
    });

    it('does not start a call when Orbit cannot answer', async () => {
        gate.check.mockResolvedValue({ allowed: false, kind: 'cannot_check', line: 'Nora can\'t check that right now. Try again soon.' });
        const response = await call();
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ started: false, code: 'cannot_check' });
        expect(botManager.startCall).not.toHaveBeenCalled();
    });

    it('only calls for the person asking', async () => {
        const response = await call({ playerUuid: 'someone-else' });
        expect(response.status).toBe(403);
        expect((await response.json()).code).toBe('not_you');
        expect(gate.check).not.toHaveBeenCalled();
        expect(botManager.startCall).not.toHaveBeenCalled();
    });

    it('needs to know who is calling', async () => {
        expect((await call({})).status).toBe(400);
        expect(botManager.startCall).not.toHaveBeenCalled();
    });

    it('asks a guest as a guest, so Orbit can tell them to sign in', async () => {
        gate.check.mockResolvedValue({ allowed: false, kind: 'refused', code: 'sign_in_required', line: 'Sign in to call Nora.' });
        const response = await call({ playerUuid: 'guest-uuid' }, { 'X-WA-Auth': GAME_TOKEN });
        expect(gate.check).toHaveBeenCalledWith('b1', 'call', { signedIn: false, identifier: undefined }, 'Nora');
        expect(response.status).toBe(403);
        expect((await response.json()).code).toBe('sign_in_required');
    });

    it('says when the bot has no voice or is not there', async () => {
        botManager.startCall.mockRejectedValueOnce(new BotCannotCallError());
        const noVoice = await call();
        expect(noVoice.status).toBe(409);
        expect((await noVoice.json()).code).toBe('no_voice');
        botManager.startCall.mockRejectedValueOnce(new BotUnavailableError('gone'));
        const gone = await call();
        expect(gone.status).toBe(404);
        expect((await gone.json()).code).toBe('not_here');
    });
});

describe('Ending a call', () => {
    const end = (body: unknown = { playerUuid: 'uuid-1' }) => post('/api/bots/b1/call/end', body, auth);

    it('ends the call of the person asking', async () => {
        const response = await end();
        expect(await response.json()).toEqual({ botId: 'b1', ended: true });
        expect(botManager.endCall).toHaveBeenCalledWith('b1', 'uuid-1');
    });

    it('never ends the call of someone else', async () => {
        const response = await end({ playerUuid: 'someone-else' });
        expect(response.status).toBe(403);
        expect(botManager.endCall).not.toHaveBeenCalled();
    });
});

describe('Asking whether a call may be made', () => {
    it('is a question the game can ask before it shows the Call button', async () => {
        const response = await post('/api/bots/b1/access', { action: 'call', playerUuid: 'uuid-1' }, auth);
        expect(response.status).toBe(200);
        expect(gate.check).toHaveBeenCalledWith('b1', 'call', { signedIn: true, identifier: 'uuid-1' }, 'Nora');
        expect(await response.json()).toEqual({ allowed: true });
    });

    it('says no for a bot with no voice, so its chat shows no Call button', async () => {
        botManager.canTakeCall.mockResolvedValue(false);
        const response = await post('/api/bots/b1/access', { action: 'call', playerUuid: 'uuid-1' }, auth);
        expect(await response.json()).toMatchObject({ allowed: false, code: 'no_voice' });
    });

    it('does not ask about the voice for any other action, nor when Orbit already said no', async () => {
        await post('/api/bots/b1/access', { action: 'dm', playerUuid: 'uuid-1' }, auth);
        gate.check.mockResolvedValue({ allowed: false, kind: 'refused', code: 'not_allowed', line: 'No' });
        await post('/api/bots/b1/access', { action: 'call', playerUuid: 'uuid-1' }, auth);
        expect(botManager.canTakeCall).not.toHaveBeenCalled();
    });
});
