/** The homeserver calls a purge of a deleted Brick's chats makes (register R29): what each one sends, and how a refusal is read. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const http = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock('axios', () => ({ default: { create: () => http }, create: () => http }));

import { MatrixAppServiceClient } from '../matrix/MatrixAppServiceClient';

const client = new MatrixAppServiceClient({ homeserverUrl: 'http://hs', domain: 'matrix.test', asToken: 't', hsToken: 'h' });
const USER = '@bot_abc:matrix.test';
const ROOM = '!room:matrix.test';

describe('MatrixAppServiceClient: calls for purging a deleted Brick\'s chats', () => {
    beforeEach(() => {
        http.get.mockReset();
        http.put.mockReset();
        http.post.mockReset();
    });

    it('lists the rooms a user joined, acting as that user', async () => {
        http.get.mockResolvedValue({ status: 200, data: { joined_rooms: [ROOM, '!b:matrix.test'] } });
        expect(await client.getJoinedRooms(USER)).toEqual([ROOM, '!b:matrix.test']);
        expect(http.get).toHaveBeenCalledWith('/_matrix/client/v3/joined_rooms', expect.objectContaining({ params: { user_id: USER } }));
    });

    it('reads a refusal as "no account" only when the homeserver confirms the account does not exist', async () => {
        http.get.mockImplementation(async (url: string) => (url.includes('/profile/') ? { status: 404, data: { errcode: 'M_NOT_FOUND' } } : { status: 403, data: { errcode: 'M_FORBIDDEN' } }));
        expect(await client.getJoinedRooms(USER)).toBeNull();
        // The same refusal for an account that exists is a failure, whatever its code says
        http.get.mockImplementation(async (url: string) => (url.includes('/profile/') ? { status: 200, data: {} } : { status: 403, data: { errcode: 'M_EXCLUSIVE' } }));
        await expect(client.getJoinedRooms(USER)).rejects.toThrow('403');
        // And when the homeserver cannot say whether it exists
        http.get.mockImplementation(async (url: string) => (url.includes('/profile/') ? { status: 502, data: {} } : { status: 403, data: {} }));
        await expect(client.getJoinedRooms(USER)).rejects.toThrow('502');
        http.get.mockReset().mockResolvedValue({ status: 502, data: {} });
        await expect(client.getJoinedRooms(USER)).rejects.toThrow('502');
    });

    it('never reads an answer that is not a list of rooms as "no rooms"', async () => {
        http.get.mockResolvedValue({ status: 200, data: {} });
        await expect(client.getJoinedRooms(USER)).rejects.toThrow('not a list');
        http.get.mockResolvedValue({ status: 200, data: { joined_rooms: [ROOM, 7] } });
        await expect(client.getJoinedRooms(USER)).rejects.toThrow('not a list');
        http.get.mockResolvedValue({ status: 200, data: { joined_rooms: [] } });
        expect(await client.getJoinedRooms(USER)).toEqual([]);
    });

    it('reads the profile as the homeserver shows it, and fails when it cannot', async () => {
        http.get.mockResolvedValue({ status: 200, data: { displayname: 'Nora', avatar_url: 'mxc://x/y' } });
        expect(await client.getProfile(USER)).toEqual({ displayName: 'Nora', avatarUrl: 'mxc://x/y' });
        http.get.mockResolvedValue({ status: 200, data: { displayname: '' } });
        expect(await client.getProfile(USER)).toEqual({ displayName: null, avatarUrl: null });
        http.get.mockResolvedValue({ status: 502, data: {} });
        await expect(client.getProfile(USER)).rejects.toThrow('502');
        http.get.mockResolvedValue({ status: 404, data: {} });
        await expect(client.getProfile(USER)).rejects.toThrow('404');
    });

    it('reads a page of history newest first, from where the last page ended', async () => {
        http.get.mockResolvedValue({ data: { chunk: [{ event_id: '$1' }], end: 't2' } });
        expect(await client.getMessagesPage(USER, ROOM, 't1', 50)).toEqual({ events: [{ event_id: '$1' }], end: 't2' });
        expect(http.get).toHaveBeenCalledWith(`/_matrix/client/v3/rooms/${encodeURIComponent(ROOM)}/messages`, { params: { user_id: USER, dir: 'b', limit: 50, from: 't1' } });
        http.get.mockResolvedValue({ data: { chunk: [] } });
        expect(await client.getMessagesPage(USER, ROOM)).toEqual({ events: [], end: undefined });
    });

    it('redacts under the event\'s own transaction id, waits out a "slow down", and fails on any other refusal', async () => {
        http.put.mockResolvedValue({ status: 200, data: {} });
        await client.redactEvent(USER, ROOM, '$ev:1', 'purge-$ev:1', 'Brick deleted');
        expect(http.put).toHaveBeenCalledWith(
            `/_matrix/client/v3/rooms/${encodeURIComponent(ROOM)}/redact/${encodeURIComponent('$ev:1')}/${encodeURIComponent('purge-$ev:1')}`,
            { reason: 'Brick deleted' },
            expect.objectContaining({ params: { user_id: USER } })
        );
        vi.useFakeTimers();
        http.put.mockReset().mockResolvedValueOnce({ status: 429, data: { retry_after_ms: 10 } }).mockResolvedValueOnce({ status: 200, data: {} });
        const slow = client.redactEvent(USER, ROOM, '$e', 'purge-$e');
        await vi.advanceTimersByTimeAsync(20);
        await slow;
        expect(http.put).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
        http.put.mockReset().mockResolvedValue({ status: 403, data: { errcode: 'M_FORBIDDEN' } });
        await expect(client.redactEvent(USER, ROOM, '$e', 'purge-$e')).rejects.toThrow('403');
    });

    it('forgets a room, counting one the homeserver no longer knows as forgotten', async () => {
        http.post.mockResolvedValue({ status: 200, data: {} });
        await client.forgetRoom(USER, ROOM);
        expect(http.post).toHaveBeenCalledWith(`/_matrix/client/v3/rooms/${encodeURIComponent(ROOM)}/forget`, {}, expect.objectContaining({ params: { user_id: USER } }));
        http.post.mockResolvedValue({ status: 404, data: { errcode: 'M_NOT_FOUND' } });
        await client.forgetRoom(USER, ROOM);
        http.post.mockResolvedValue({ status: 500, data: {} });
        await expect(client.forgetRoom(USER, ROOM)).rejects.toThrow('500');
    });

    it('waits out a "slow down" on a forget, and gives up after a few', async () => {
        vi.useFakeTimers();
        http.post.mockReset().mockResolvedValueOnce({ status: 429, data: { retry_after_ms: 10 } }).mockResolvedValueOnce({ status: 200, data: {} });
        const slow = client.forgetRoom(USER, ROOM);
        await vi.advanceTimersByTimeAsync(20);
        await slow;
        expect(http.post).toHaveBeenCalledTimes(2);
        http.post.mockReset().mockResolvedValue({ status: 429, data: { retry_after_ms: 1 } });
        const never = client.forgetRoom(USER, ROOM);
        const failed = expect(never).rejects.toThrow('429');
        await vi.advanceTimersByTimeAsync(100);
        await failed;
        vi.useRealTimers();
    });

    it('takes the name and the picture off with empty values', async () => {
        http.put.mockResolvedValue({ status: 200, data: {} });
        await client.clearProfile(USER);
        expect(http.put).toHaveBeenCalledWith(`/_matrix/client/v3/profile/${encodeURIComponent(USER)}/displayname`, { displayname: '' }, { params: { user_id: USER } });
        expect(http.put).toHaveBeenCalledWith(`/_matrix/client/v3/profile/${encodeURIComponent(USER)}/avatar_url`, { avatar_url: '' }, { params: { user_id: USER } });
    });
});
