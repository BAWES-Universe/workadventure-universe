import { describe, it, expect, vi } from 'vitest';
import { BotAPI } from '../server/BotAPI';

describe('Bot states for the game', () => {
    it('answers signed-in people with each bot state, and only when direct messages are on', async () => {
        const admin: any = { validateSessionToken: vi.fn(async () => ({ uuid: 'u1', email: 'a@b.c' })) };
        const dmStatus = vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, 'resting'])));
        const api: any = new BotAPI({} as any, admin, {} as any, [], { dmStatus });
        const server = api.app.listen(0);
        const base = `http://127.0.0.1:${server.address().port}`;
        const token = 'orb_sess_v2_' + 'a'.repeat(64);
        expect((await fetch(`${base}/api/bots/dm-status?ids=b1`)).status).toBe(401);
        const ok = await fetch(`${base}/api/bots/dm-status?ids=b1,b2,b1`, { headers: { Authorization: `Bearer ${token}` } });
        expect(ok.status).toBe(200);
        expect(await ok.json()).toEqual({ bots: { b1: 'resting', b2: 'resting' } });
        expect((await fetch(`${base}/api/bots/dm-status?ids=`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(400);
        const off: any = new BotAPI({} as any, admin, {} as any, []);
        const s2 = off.app.listen(0);
        expect((await fetch(`http://127.0.0.1:${s2.address().port}/api/bots/dm-status?ids=b1`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(404);
        server.close();
        s2.close();
    });
});
