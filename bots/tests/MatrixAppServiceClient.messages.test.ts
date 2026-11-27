/** Reading the latest messages of a room follows the homeserver's pages (an empty page with an `end` token does not mean there is nothing more). */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const http = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock('axios', () => ({ default: { create: () => http }, create: () => http }));

import { MatrixAppServiceClient } from '../matrix/MatrixAppServiceClient';

const client = new MatrixAppServiceClient({ homeserverUrl: 'http://hs', domain: 'matrix.test', asToken: 't', hsToken: 'h' });
const USER = '@bot_abc:matrix.test';
const ROOM = '!room:matrix.test';
const message = (id: string) => ({ event_id: id, type: 'm.room.message', sender: USER, room_id: ROOM, content: { msgtype: 'm.notice', body: id }, origin_server_ts: 1 });

describe('MatrixAppServiceClient.getRecentMessages', () => {
    beforeEach(() => {
        http.get.mockReset();
    });

    it('reads one page when it holds enough, newest last, and asks for no other', async () => {
        http.get.mockResolvedValueOnce({ data: { chunk: [message('$3'), message('$2'), message('$1')], end: 'tok1' } });
        const got = await client.getRecentMessages(USER, ROOM, 3);
        expect(got.map((one) => one.event_id)).toEqual(['$1', '$2', '$3']);
        expect(http.get).toHaveBeenCalledTimes(1);
    });

    it('follows `end` past an empty page: a message on a later page is found', async () => {
        http.get
            .mockResolvedValueOnce({ data: { chunk: [], end: 'tok1' } })
            .mockResolvedValueOnce({ data: { chunk: [], end: 'tok2' } })
            .mockResolvedValueOnce({ data: { chunk: [message('$old')], end: 'tok3' } })
            .mockResolvedValueOnce({ data: { chunk: [] } });
        const got = await client.getRecentMessages(USER, ROOM, 50, { types: ['m.room.message'], senders: [USER] });
        expect(got.map((one) => one.event_id)).toEqual(['$old']);
        expect(http.get.mock.calls[1][1].params.from).toBe('tok1');
        expect(http.get.mock.calls[2][1].params.from).toBe('tok2');
        expect(http.get.mock.calls[3][1].params.from).toBe('tok3');
    });

    it('stops at the limit, joining pages newest first, and returns them oldest first', async () => {
        http.get
            .mockResolvedValueOnce({ data: { chunk: [message('$5'), message('$4')], end: 'tok1' } })
            .mockResolvedValueOnce({ data: { chunk: [message('$3'), message('$2'), message('$1')], end: 'tok2' } });
        const got = await client.getRecentMessages(USER, ROOM, 4);
        expect(got.map((one) => one.event_id)).toEqual(['$2', '$3', '$4', '$5']);
        expect(http.get).toHaveBeenCalledTimes(2);
    });

    it('ends when the history ends: no `end` token', async () => {
        http.get.mockResolvedValueOnce({ data: { chunk: [message('$1')] } });
        expect((await client.getRecentMessages(USER, ROOM, 50)).map((one) => one.event_id)).toEqual(['$1']);
        expect(http.get).toHaveBeenCalledTimes(1);
    });

    it('throws when the history could not be read to its end, never "none"', async () => {
        let n = 0;
        http.get.mockImplementation(async () => ({ data: { chunk: [], end: `tok${++n}` } }));
        await expect(client.getRecentMessages(USER, ROOM, 50)).rejects.toThrow(/not read to its end/);
        expect(http.get.mock.calls.length).toBeLessThanOrEqual(40);
    });

    it('a failed page fails the read', async () => {
        http.get.mockImplementation(async () => {
            throw new Error('502');
        });
        let failure: unknown;
        try {
            await client.getRecentMessages(USER, ROOM, 50);
        } catch (error) {
            failure = error;
        }
        expect((failure as Error).message).toBe('502');
    });
});
