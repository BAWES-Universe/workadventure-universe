import { describe, it, expect, vi } from 'vitest';
import { BotAPI } from '../server/BotAPI';

describe('Bot states for the game', () => {
    it('answers signed-in people with each bot state, and only when direct messages are on', async () => {
        const admin: any = { validateSessionToken: vi.fn(async () => ({ uuid: 'u1', email: 'a@b.c' })) };
        const dmStatus = vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, 'resting'])));
        const gate = { check: vi.fn(async () => ({ allowed: true, kind: 'allowed' })) };
        const api: any = new BotAPI({ getAccessGate: () => gate } as any, admin, {} as any, [], { dmStatus });
        const server = api.app.listen(0);
        const base = `http://127.0.0.1:${server.address().port}`;
        const token = 'orb_sess_v2_' + 'a'.repeat(64);
        expect((await fetch(`${base}/api/bots/dm-status?ids=b1`)).status).toBe(401);
        const ok = await fetch(`${base}/api/bots/dm-status?ids=b1,b2,b1`, { headers: { Authorization: `Bearer ${token}` } });
        expect(ok.status).toBe(200);
        expect(await ok.json()).toEqual({ bots: { b1: 'resting', b2: 'resting' } });
        expect((await fetch(`${base}/api/bots/dm-status?ids=`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(400);
        // The limit counts distinct bots, so repeats of the same few ids are fine.
        const repeats = Array(60).fill('b1').join(',');
        expect((await fetch(`${base}/api/bots/dm-status?ids=${repeats}`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
        const many = Array.from({ length: 51 }, (_, i) => `b${i}`).join(',');
        expect((await fetch(`${base}/api/bots/dm-status?ids=${many}`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(400);
        const off: any = new BotAPI({} as any, admin, {} as any, []);
        const s2 = off.app.listen(0);
        expect((await fetch(`http://127.0.0.1:${s2.address().port}/api/bots/dm-status?ids=b1`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(404);
        server.close();
        s2.close();
    });

    it('says nothing about a bot to someone who may not message it, and still says a deleted bot is gone', async () => {
        const admin: any = { validateSessionToken: vi.fn(async () => ({ uuid: 'u1', email: 'a@b.c' })) };
        const states: Record<string, string> = { open: 'resting', limited: 'unready', deleted: 'gone', down: 'unknown' };
        const dmStatus = vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, states[id]])));
        const gate = {
            check: vi.fn(async (botId: string) =>
                botId === 'limited'
                    ? { allowed: false, kind: 'refused', code: 'limited', line: 'no' }
                    : { allowed: true, kind: 'allowed' }
            ),
        };
        const api: any = new BotAPI({ getAccessGate: () => gate } as any, admin, {} as any, [], { dmStatus });
        const server = api.app.listen(0);
        const response = await fetch(
            `http://127.0.0.1:${server.address().port}/api/bots/dm-status?ids=open,limited,deleted,down`,
            { headers: { Authorization: `Bearer orb_sess_v2_${'a'.repeat(64)}` } }
        );
        expect(await response.json()).toEqual({
            bots: { open: 'resting', limited: 'unknown', deleted: 'gone', down: 'unknown' },
        });
        // Asked as the signed-in caller, the same question the Message button asks, and only where a state would show.
        expect(gate.check).toHaveBeenCalledWith('open', 'dm', { signedIn: true, identifier: 'u1' });
        expect(gate.check.mock.calls.map(([botId]) => botId).sort()).toEqual(['limited', 'open']);
        server.close();
    });
});
