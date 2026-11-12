/**
 * POST /api/bricks/visit/sync (game #2005): the person is the one the Orbit session names, the room must be one people
 * are really in, and one person can only ask so often (Sentry on #2023).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

vi.mock('../mcp/MCPConnector', () => ({ MCPConnector: { clearCache: vi.fn() } }));
vi.mock('../utils/MovementLogger', () => ({ movementLogger: {} }));

import { BotAPI } from '../server/BotAPI';

const SESSION = `orb_sess_v2_${'a'.repeat(64)}`;
const ROOM = 'http://play.test/@/team/universe/room';

describe('POST /api/bricks/visit/sync', () => {
    const adminApiService = { validateSessionToken: vi.fn() };
    const botManager = { getAccessGate: vi.fn(), syncVisitingBrick: vi.fn(), hasPlayersIn: vi.fn() };
    let server: Server;
    let base: string;

    beforeAll(async () => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const api = new BotAPI(botManager as never, adminApiService as never, {} as never, []);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const app = (api as any).app;
        server = await new Promise<Server>((resolve) => {
            const started = app.listen(0, () => resolve(started));
        });
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    beforeEach(() => {
        vi.clearAllMocks();
        adminApiService.validateSessionToken.mockResolvedValue({ userId: 'u1', uuid: 'uuid-alice', email: 'a@b.c' });
        botManager.hasPlayersIn.mockResolvedValue(true);
        botManager.syncVisitingBrick.mockResolvedValue({ botId: 'brick-1' });
    });

    const sync = (body: unknown = { roomId: ROOM }, headers: Record<string, string> = { Authorization: `Bearer ${SESSION}` }) =>
        fetch(`${base}/api/bricks/visit/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

    it('puts the Brick of the person the session names in a room people are in, and says it is on the map', async () => {
        const answer = await sync({ roomId: ROOM, x: 40, y: 50 });
        expect(answer.status).toBe(200);
        expect(await answer.json()).toEqual({ present: true });
        expect(botManager.syncVisitingBrick).toHaveBeenCalledWith(ROOM, { uuid: 'uuid-alice' }, { x: 40, y: 50 }, true);
    });

    it('says the Brick is not on the map when there is none for this person', async () => {
        botManager.syncVisitingBrick.mockResolvedValue({ botId: null });
        expect(await (await sync()).json()).toEqual({ present: false });
    });

    it('puts nothing in a room nobody is really in, whatever room the caller names', async () => {
        botManager.hasPlayersIn.mockResolvedValue(false);
        const answer = await sync({ roomId: 'http://play.test/@/someone/else/private' });
        expect(answer.status).toBe(200);
        expect(await answer.json()).toEqual({ present: false });
        expect(botManager.syncVisitingBrick).not.toHaveBeenCalled();
    });

    it('lets one person ask only so often', async () => {
        adminApiService.validateSessionToken.mockResolvedValue({ userId: 'u-busy', uuid: 'uuid-busy', email: null });
        const answers: number[] = [];
        for (let i = 0; i < 61; i++) answers.push((await sync()).status);
        expect(answers.slice(0, 60).every((status) => status === 200)).toBe(true);
        expect(answers[60]).toBe(429);
        expect(botManager.syncVisitingBrick).toHaveBeenCalledTimes(60);
    });

    it('never holds up the end of a visit: no room check, its own allowance, and it only takes the Brick off (Sentry on #2023)', async () => {
        botManager.hasPlayersIn.mockResolvedValue(false);
        botManager.syncVisitingBrick.mockResolvedValue({ botId: null });
        const answer = await sync({ roomId: ROOM, ending: true, x: 1, y: 2 });
        expect(answer.status).toBe(200);
        expect(await answer.json()).toEqual({ present: false });
        expect(botManager.hasPlayersIn).not.toHaveBeenCalled();
        expect(botManager.syncVisitingBrick).toHaveBeenCalledWith(ROOM, { uuid: 'uuid-alice' }, undefined, false);
    });

    it('lets a person who used up their placements still end a visit', async () => {
        adminApiService.validateSessionToken.mockResolvedValue({ userId: 'u-spent', uuid: 'uuid-spent', email: null });
        for (let i = 0; i < 61; i++) await sync();
        expect((await sync()).status).toBe(429);
        botManager.syncVisitingBrick.mockClear();
        expect((await sync({ roomId: ROOM, ending: true })).status).toBe(200);
        expect(botManager.syncVisitingBrick).toHaveBeenCalledTimes(1);
    });

    it('needs an Orbit session and a room', async () => {
        expect((await sync({ roomId: ROOM }, {})).status).toBe(401);
        expect((await sync({})).status).toBe(400);
        expect(botManager.syncVisitingBrick).not.toHaveBeenCalled();
    });
});
