import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { MatrixDmBridge } from '../matrix/MatrixDmBridge';
import { createMatrixAppServiceRouter, type MatrixEvent } from '../matrix/MatrixAppServiceRouter';
import { botIdFromMatrixId, botMatrixId, readMatrixConfig } from '../matrix/MatrixConfig';
import { BOT_STATUS_KEY, availabilityOf, detectLanguage, statusNoteContent } from '../matrix/BotStatusNotes';

const config = { homeserverUrl: 'http://hs', domain: 'matrix.test', asToken: 'as-secret', hsToken: 'hs-secret' };
const BOT = '0b7c1d2e-1111-4222-8333-944455556666';
const BOT_USER = `@bot_${BOT}:matrix.test`;
const ALICE = '@alice:matrix.test';
const BOB = '@bob:matrix.test';
const ROOM = '!dm:matrix.test';

// Loosely typed so tests can reach the vi.fn helpers on each method.
function makeClient(): any {
    return {
        ensureRegistered: vi.fn(async () => undefined),
        setDisplayName: vi.fn(async () => undefined),
        getDisplayName: vi.fn(async (): Promise<string | null> => 'Guide'),
        joinRoom: vi.fn(async () => undefined),
        leaveRoom: vi.fn(async () => undefined),
        sendText: vi.fn(async () => '$evt'),
        sendMessage: vi.fn(async () => '$evt'),
        setTyping: vi.fn(async () => undefined),
        getJoinedMembers: vi.fn(async () => [ALICE, BOT_USER]),
        getRecentMessages: vi.fn(async (): Promise<MatrixEvent[]> => []),
        uploadMedia: vi.fn(async () => 'mxc://matrix.test/abc'),
        downloadMedia: vi.fn(async () => ({ data: Buffer.from('hi'), contentType: 'text/plain' })),
    };
}

function makeDeps(): any {
    const rooms = new Map<string, string>();
    return {
        getBotConfig: vi.fn(async () => ({ botId: BOT, name: 'Guide', enabled: true, aiProviderRef: 'p' }) as never),
        checkAccess: vi.fn(async () => ({ allowed: true, reason: null, user: { uuid: 'uuid-alice', name: 'Alice', isGuest: false } })),
        reply: vi.fn(async (): Promise<any> => ({ text: 'Hello Alice!', media: [] })),
        restingLine: vi.fn(async () => 'The ship is in the harbour, come back later!'),
        rooms: {
            rememberDmRoom: vi.fn(async (r: string, b: string) => void rooms.set(r, b)),
            getDmRoomBot: vi.fn(async (r: string) => rooms.get(r) ?? null),
            forgetDmRoom: vi.fn(async (r: string) => void rooms.delete(r)),
        },
    };
}

const invite = (overrides: Partial<MatrixEvent> = {}, content: Record<string, unknown> = { membership: 'invite', is_direct: true }): MatrixEvent => ({
    type: 'm.room.member', room_id: ROOM, sender: ALICE, event_id: '$i', state_key: BOT_USER, content, ...overrides,
});
const message = (body: string, sender = ALICE): MatrixEvent => ({
    type: 'm.room.message', room_id: ROOM, sender, event_id: `$m${Math.random()}`, content: { msgtype: 'm.text', body },
});

describe('MatrixConfig', () => {
    it('is off unless all four values are set', () => {
        expect(readMatrixConfig({ MATRIX_HOMESERVER_URL: 'http://hs' } as never)).toBeNull();
        expect(readMatrixConfig({ MATRIX_HOMESERVER_URL: 'http://hs/', MATRIX_DOMAIN: 'd', MATRIX_AS_TOKEN: 'a', MATRIX_HS_TOKEN: 'h' } as never))
            .toEqual({ homeserverUrl: 'http://hs', domain: 'd', asToken: 'a', hsToken: 'h' });
    });

    it('maps bot ids to Matrix IDs and back, only inside our namespace', () => {
        expect(botMatrixId('matrix.test', BOT)).toBe(BOT_USER);
        expect(botMatrixId('matrix.test', 'Has Upper')).toBeUndefined();
        expect(botIdFromMatrixId('matrix.test', BOT_USER)).toBe(BOT);
        expect(botIdFromMatrixId('matrix.test', ALICE)).toBeNull();
        expect(botIdFromMatrixId('matrix.test', `@bot_${BOT}:elsewhere.org`)).toBeNull();
        // Nothing that could step out of a URL path segment: Orbit bot ids are uuids.
        expect(botIdFromMatrixId('matrix.test', '@bot_../../admin:matrix.test')).toBeNull();
        expect(botIdFromMatrixId('matrix.test', '@bot_a/b:matrix.test')).toBeNull();
        expect(botMatrixId('matrix.test', '../x')).toBeUndefined();
    });
});

describe('MatrixDmBridge', () => {
    let client: any;
    let deps: any;
    let bridge: MatrixDmBridge;

    beforeEach(() => {
        client = makeClient();
        deps = makeDeps();
        bridge = new MatrixDmBridge(config, client as never, deps);
    });

    it('tries the bot name again next time when setting it failed', async () => {
        client.setDisplayName.mockRejectedValueOnce(new Error('homeserver busy'));
        expect(await bridge.userExists(BOT_USER)).toBe(true);
        expect(await bridge.userExists(BOT_USER)).toBe(true);
        expect(client.setDisplayName).toHaveBeenCalledTimes(2);
        expect(await bridge.userExists(BOT_USER)).toBe(true);
        expect(client.setDisplayName).toHaveBeenCalledTimes(2);
    });

    it('creates the bot account on first lookup and names it after the bot', async () => {
        expect(await bridge.userExists(BOT_USER)).toBe(true);
        expect(client.ensureRegistered).toHaveBeenCalledWith(`bot_${BOT}`);
        expect(client.setDisplayName).toHaveBeenCalledWith(BOT_USER, 'Guide');
        expect(await bridge.userExists(ALICE)).toBe(false);
        // A resting bot still exists, so a chat with it can open and explain; a deleted one does not.
        deps.getBotConfig.mockResolvedValueOnce({ enabled: false } as never);
        expect(await bridge.userExists(BOT_USER)).toBe(true);
        deps.getBotConfig.mockResolvedValueOnce(null as never);
        expect(await bridge.userExists(BOT_USER)).toBe(false);
    });

    it('joins a direct chat from someone allowed, and replies to their messages', async () => {
        await bridge.onEvent(invite());
        expect(deps.checkAccess).toHaveBeenCalledWith(BOT, ALICE);
        expect(client.joinRoom).toHaveBeenCalledWith(BOT_USER, ROOM);
        expect(client.leaveRoom).not.toHaveBeenCalled();

        await bridge.onEvent(message('hi there'));
        expect(deps.reply).toHaveBeenCalledWith(BOT, { matrixUserId: ALICE, uuid: 'uuid-alice', name: 'Alice', isGuest: false }, 'hi there', [], expect.anything());
        expect(client.sendText).toHaveBeenCalledWith(BOT_USER, ROOM, 'Hello Alice!');
        // A quick reply needs no typing notice.
        expect(client.setTyping).not.toHaveBeenCalled();
    });

    it("sends a reply that names the bot's room with its link, for the game's card", async () => {
        await bridge.onEvent(invite());
        const roomLink = { url: 'https://play.example/@/bawes/hq/lobby', room: 'Lobby', world: 'BAWES HQ', universe: 'BAWES' };
        deps.reply.mockResolvedValueOnce({ text: 'I live in the Lobby.', media: [], roomLink });
        await bridge.onEvent(message('where u at'));
        expect(client.sendMessage).toHaveBeenCalledWith(BOT_USER, ROOM, {
            msgtype: 'm.text',
            body: 'I live in the Lobby.',
            'universe.room_link': roomLink,
        });
        expect(client.sendText).not.toHaveBeenCalled();
    });

    it('shows typing while a slow reply is on its way, then clears it', async () => {
        vi.useFakeTimers();
        try {
            let finish: (v: unknown) => void = () => undefined;
            deps.reply.mockImplementationOnce(() => new Promise((r) => (finish = r)));
            await bridge.onEvent(invite());
            const pending = bridge.onEvent(message('think hard'));
            await vi.advanceTimersByTimeAsync(1000);
            expect(client.setTyping).toHaveBeenCalledWith(BOT_USER, ROOM, true);
            finish({ text: 'Done thinking.', media: [] });
            await pending;
            expect(client.setTyping).toHaveBeenLastCalledWith(BOT_USER, ROOM, false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('checks room members once and then follows membership events', async () => {
        await bridge.onEvent(invite());
        await bridge.onEvent(message('one'));
        await bridge.onEvent(message('two'));
        expect(client.getJoinedMembers).toHaveBeenCalledTimes(1);
        await bridge.onEvent({ type: 'm.room.member', room_id: ROOM, sender: ALICE, event_id: '$j', state_key: '@carol:matrix.test', content: { membership: 'join' } });
        await bridge.onEvent(message('three'));
        expect(deps.reply).toHaveBeenCalledTimes(2);
    });

    it('answers a message typed before it joined, once, even if Synapse also pushes it', async () => {
        const early = { ...message('are you there?'), origin_server_ts: 2000 };
        client.getRecentMessages.mockResolvedValueOnce([
            { type: 'm.room.member', room_id: ROOM, sender: ALICE, event_id: '$c', state_key: ALICE, content: { membership: 'join' }, origin_server_ts: 1000 },
            early,
        ]);
        await bridge.onEvent(invite({ origin_server_ts: 1500 }));
        await bridge.onEvent(early);
        expect(deps.reply).toHaveBeenCalledTimes(1);
        expect(deps.reply.mock.calls[0][2]).toBe('are you there?');
    });

    it('answers only the latest early message when the invite has no time to compare against', async () => {
        client.getRecentMessages.mockResolvedValueOnce([
            { ...message('old question'), origin_server_ts: 1000 },
            { ...message('are you there?'), origin_server_ts: 2000 },
        ]);
        await bridge.onEvent(invite());
        expect(deps.reply).toHaveBeenCalledTimes(1);
        expect(deps.reply.mock.calls[0][2]).toBe('are you there?');
    });

    it('sends what the bot says before a tool call as its own message', async () => {
        deps.reply.mockImplementationOnce(async (_b: string, _p: unknown, _t: string, _a: unknown, hooks: any) => {
            await hooks.onInterimMessage('Let me look.');
            return { text: 'Found it.', media: [] };
        });
        await bridge.onEvent(invite());
        await bridge.onEvent(message('find it'));
        expect(client.sendText.mock.calls.map((c) => c[2])).toEqual(['Let me look.', 'Found it.']);
    });

    it('still sends the answer when the interim message fails to send', async () => {
        deps.reply.mockImplementationOnce(async (_b: string, _p: unknown, _t: string, _a: unknown, hooks: any) => {
            await hooks.onInterimMessage('Let me look.');
            return { text: 'Found it.', media: [] };
        });
        client.sendText.mockRejectedValueOnce(new Error('timeout'));
        await bridge.onEvent(invite());
        await bridge.onEvent(message('find it'));
        expect(client.sendText).toHaveBeenLastCalledWith(BOT_USER, ROOM, 'Found it.');
    });

    const alice = { uuid: 'uuid-alice', name: 'Alice', isGuest: false };

    it('asks Orbit before joining and again after joining, before reading the chat history', async () => {
        const order: string[] = [];
        client.joinRoom.mockImplementation(async () => void order.push('join'));
        client.getRecentMessages.mockImplementation(async () => {
            order.push('history');
            return [];
        });
        deps.checkAccess.mockImplementation(async () => {
            order.push('access');
            return { allowed: true, reason: null, user: alice };
        });
        await bridge.onEvent(invite());
        expect(order).toEqual(['access', 'join', 'access', 'history']);
        // Neither check may come from the cache, or a ban landing in between would go unseen.
        expect(deps.checkAccess).toHaveBeenCalledTimes(2);
        await bridge.onEvent(invite({ event_id: '$invite2', room_id: '!other:matrix.test' }));
        expect(deps.checkAccess).toHaveBeenCalledTimes(4);
    });

    it('declines without joining when Orbit says the person may not reach the bot', async () => {
        deps.checkAccess.mockResolvedValue({ allowed: false, reason: 'no_room_access', user: null });
        await bridge.onEvent(invite());
        expect(client.joinRoom).not.toHaveBeenCalled();
        expect(client.getRecentMessages).not.toHaveBeenCalled();
        expect(client.leaveRoom).toHaveBeenCalledWith(BOT_USER, ROOM);
        expect(client.sendMessage).not.toHaveBeenCalled();
        expect(deps.rooms!.rememberDmRoom).not.toHaveBeenCalled();
        await bridge.onEvent(message('hello?'));
        expect(deps.reply).not.toHaveBeenCalled();
    });

    it('declines without joining for every kind of Orbit failure, and never treats a failure as a yes', async () => {
        for (const reason of ['admin_api_error', 'admin_api_status_500', 'admin_api_not_configured', 'admin_api_missing_user']) {
            deps.checkAccess.mockResolvedValue({ allowed: false, reason, user: null });
            await bridge.onEvent(invite({ event_id: `$${reason}` }));
        }
        // A yes with nobody named is not a yes either.
        deps.checkAccess.mockResolvedValue({ allowed: true, reason: null, user: null });
        await bridge.onEvent(invite({ event_id: '$nobody' }));
        expect(client.joinRoom).not.toHaveBeenCalled();
        expect(client.leaveRoom).toHaveBeenCalledTimes(5);
        expect(deps.rooms!.rememberDmRoom).not.toHaveBeenCalled();
        await bridge.onEvent(message('hello?'));
        expect(deps.reply).not.toHaveBeenCalled();
    });

    it('does not join when the Orbit client throws', async () => {
        deps.checkAccess.mockRejectedValue(new Error('socket hang up'));
        await bridge.onEvent(invite());
        expect(client.joinRoom).not.toHaveBeenCalled();
        expect(client.leaveRoom).toHaveBeenCalledWith(BOT_USER, ROOM);
    });

    it('leaves without reading the chat when access is lost while the join is under way', async () => {
        deps.checkAccess
            .mockResolvedValueOnce({ allowed: true, reason: null, user: alice })
            .mockResolvedValueOnce({ allowed: false, reason: 'banned', user: null });
        client.getRecentMessages.mockResolvedValue([{ ...message('sneaky'), origin_server_ts: 5000 }]);
        await bridge.onEvent(invite({ origin_server_ts: 1000 }));
        expect(client.joinRoom).toHaveBeenCalledWith(BOT_USER, ROOM);
        expect(client.getRecentMessages).not.toHaveBeenCalled();
        expect(client.leaveRoom).toHaveBeenCalledWith(BOT_USER, ROOM);
        expect(deps.rooms!.rememberDmRoom).not.toHaveBeenCalled();
        expect(deps.reply).not.toHaveBeenCalled();
        expect(client.sendText).not.toHaveBeenCalled();
        expect(client.sendMessage).not.toHaveBeenCalled();
    });

    it('leaves without reading the chat when Orbit cannot answer the check after joining', async () => {
        deps.checkAccess
            .mockResolvedValueOnce({ allowed: true, reason: null, user: alice })
            .mockResolvedValueOnce({ allowed: false, reason: 'admin_api_error', user: null });
        await bridge.onEvent(invite());
        expect(client.getRecentMessages).not.toHaveBeenCalled();
        expect(client.leaveRoom).toHaveBeenCalledWith(BOT_USER, ROOM);
        expect(deps.rooms!.rememberDmRoom).not.toHaveBeenCalled();
        await bridge.onEvent(message('hello?'));
        expect(deps.reply).not.toHaveBeenCalled();
    });

    it('leaves without reading the chat when the owner limits the person while the join is under way', async () => {
        deps.checkAccess
            .mockResolvedValueOnce({ allowed: true, reason: null, user: alice })
            .mockResolvedValueOnce({ allowed: false, reason: 'not_allowed', user: null });
        await bridge.onEvent(invite());
        expect(client.getRecentMessages).not.toHaveBeenCalled();
        expect(client.leaveRoom).toHaveBeenCalledWith(BOT_USER, ROOM);
        expect(deps.rooms!.rememberDmRoom).not.toHaveBeenCalled();
    });

    it('declines a new invite while the bot is off, or from someone the owner limits', async () => {
        deps.getBotConfig.mockResolvedValue({ botId: BOT, name: 'Guide', enabled: false, aiProviderRef: 'p' } as never);
        await bridge.onEvent(invite());
        expect(deps.checkAccess).not.toHaveBeenCalled();
        deps.getBotConfig.mockResolvedValue({ botId: BOT, name: 'Guide', enabled: true, aiProviderRef: 'p' } as never);
        deps.checkAccess.mockResolvedValue({ allowed: false, reason: 'not_allowed', user: null });
        await bridge.onEvent(invite({ event_id: '$invite2' }));
        expect(client.joinRoom).not.toHaveBeenCalled();
        expect(client.leaveRoom).toHaveBeenCalledTimes(2);
        expect(deps.rooms!.rememberDmRoom).not.toHaveBeenCalled();
    });

    it('declines a new invite for a deleted bot', async () => {
        deps.getBotConfig.mockResolvedValue(null as never);
        await bridge.onEvent(invite());
        expect(deps.checkAccess).not.toHaveBeenCalled();
        expect(client.joinRoom).not.toHaveBeenCalled();
        expect(client.leaveRoom).toHaveBeenCalledWith(BOT_USER, ROOM);
    });

    it('declines an invite it cannot take right now, instead of staying invited and silent', async () => {
        deps.getBotConfig.mockRejectedValueOnce(new Error('orbit down'));
        await bridge.onEvent(invite());
        expect(client.joinRoom).not.toHaveBeenCalled();
        expect(client.leaveRoom).toHaveBeenCalledWith(BOT_USER, ROOM);
        client.ensureRegistered.mockRejectedValueOnce(new Error('synapse busy'));
        await bridge.onEvent(invite({ event_id: '$invite2' }));
        expect(client.joinRoom).not.toHaveBeenCalled();
        expect(client.leaveRoom).toHaveBeenCalledTimes(2);
    });

    it('turns down invites to rooms that are not direct chats, like area chats', async () => {
        await bridge.onEvent(invite({}, { membership: 'invite' }));
        expect(client.joinRoom).not.toHaveBeenCalled();
        expect(client.leaveRoom).toHaveBeenCalledWith(BOT_USER, ROOM, expect.any(String));
        expect(deps.checkAccess).not.toHaveBeenCalled();
    });

    it('retries a failed join and then answers as usual', async () => {
        (bridge as any).joinRetryDelaysMs = [0, 0];
        client.joinRoom.mockRejectedValueOnce(new Error('502')).mockRejectedValueOnce(new Error('timeout'));
        await bridge.onEvent(invite());
        expect(client.joinRoom).toHaveBeenCalledTimes(3);
        await bridge.onEvent(message('hello'));
        expect(client.sendText).toHaveBeenCalledWith(BOT_USER, ROOM, 'Hello Alice!');
    });

    it('declines the invite when every join attempt fails, so it is not left hanging', async () => {
        (bridge as any).joinRetryDelaysMs = [0, 0];
        client.joinRoom.mockRejectedValue(new Error('down'));
        await bridge.onEvent(invite());
        expect(client.joinRoom).toHaveBeenCalledTimes(3);
        expect(client.leaveRoom).toHaveBeenCalledWith(BOT_USER, ROOM);
        expect(deps.rooms!.rememberDmRoom).not.toHaveBeenCalled();
    });

    it('keeps the access cache bounded, dropping the oldest pairs first', async () => {
        const access = (chatId: string) => (bridge as any).access(BOT, chatId);
        for (let i = 0; i <= 5000; i++) await access(`@p${i}:matrix.test`);
        const cache: Map<string, unknown> = (bridge as any).accessCache;
        expect(cache.size).toBe(5000);
        expect(cache.has(`${BOT}|@p0:matrix.test`)).toBe(false);
        expect(cache.has(`${BOT}|@p5000:matrix.test`)).toBe(true);
    });

    it('stays quiet once a third person is in the room, and ignores other bots and edits', async () => {
        await bridge.onEvent(invite());
        client.getJoinedMembers.mockResolvedValueOnce([ALICE, BOT_USER, '@carol:matrix.test']);
        await bridge.onEvent(message('hi all'));
        await bridge.onEvent(message('loop', `@bot_other:matrix.test`));
        await bridge.onEvent({ ...message('fixed'), content: { msgtype: 'm.text', body: '* fixed', 'm.relates_to': { rel_type: 'm.replace' } } });
        expect(deps.reply).not.toHaveBeenCalled();
    });

    it('stops answering when access is lost, refusing once rather than every message', async () => {
        await bridge.onEvent(invite());
        deps.checkAccess.mockResolvedValue({ allowed: false, reason: 'banned', user: null });
        // The invite cached an allowed answer; a fresh bridge state is what a minute later looks like.
        (bridge as any).accessCache.clear();
        await bridge.onEvent(message('one'));
        await bridge.onEvent(message('two'));
        expect(deps.reply).not.toHaveBeenCalled();
        expect(client.sendMessage).toHaveBeenCalledTimes(1);
        expect(client.sendText).not.toHaveBeenCalled();
    });

    it('remembers its rooms across a restart through the shared store', async () => {
        await bridge.onEvent(invite());
        const restarted = new MatrixDmBridge(config, client as never, deps);
        await restarted.onEvent(message('still there?'));
        expect(deps.reply).toHaveBeenCalledTimes(1);
    });

    it('leaves and forgets the room when the person leaves', async () => {
        await bridge.onEvent(invite());
        await bridge.onEvent({ type: 'm.room.member', room_id: ROOM, sender: ALICE, event_id: '$l', state_key: ALICE, content: { membership: 'leave' } });
        expect(client.leaveRoom).toHaveBeenCalledWith(BOT_USER, ROOM);
        expect(deps.rooms!.forgetDmRoom).toHaveBeenCalledWith(ROOM);
        await bridge.onEvent(message('hello?'));
        expect(deps.reply).not.toHaveBeenCalled();
    });

    it('stays when someone other than the person leaves, then leaves with the person', async () => {
        await bridge.onEvent(invite());
        await bridge.onEvent(message('hi'));
        const carol = '@carol:matrix.test';
        // The person invited Carol, who declined.
        await bridge.onEvent({ type: 'm.room.member', room_id: ROOM, sender: carol, event_id: '$d', state_key: carol, content: { membership: 'leave' } });
        // Carol joined, then left again.
        await bridge.onEvent({ type: 'm.room.member', room_id: ROOM, sender: carol, event_id: '$cj', state_key: carol, content: { membership: 'join' } });
        await bridge.onEvent({ type: 'm.room.member', room_id: ROOM, sender: carol, event_id: '$cl', state_key: carol, content: { membership: 'leave' } });
        expect(client.leaveRoom).not.toHaveBeenCalled();
        await bridge.onEvent(message('still here'));
        expect(deps.reply).toHaveBeenCalledTimes(2);
        await bridge.onEvent({ type: 'm.room.member', room_id: ROOM, sender: ALICE, event_id: '$l', state_key: ALICE, content: { membership: 'leave' } });
        expect(client.leaveRoom).toHaveBeenCalledWith(BOT_USER, ROOM);
    });

    it('after a restart, reads who is left before leaving', async () => {
        await bridge.onEvent(invite());
        const restarted = new MatrixDmBridge(config, client as never, deps);
        const carol = '@carol:matrix.test';
        await restarted.onEvent({ type: 'm.room.member', room_id: ROOM, sender: carol, event_id: '$cl', state_key: carol, content: { membership: 'leave' } });
        expect(client.leaveRoom).not.toHaveBeenCalled();
        client.getJoinedMembers.mockRejectedValueOnce(new Error('down'));
        const again = new MatrixDmBridge(config, client as never, deps);
        await again.onEvent({ type: 'm.room.member', room_id: ROOM, sender: ALICE, event_id: '$l', state_key: ALICE, content: { membership: 'leave' } });
        expect(client.leaveRoom).toHaveBeenCalledWith(BOT_USER, ROOM);
    });

    const noteStates = () =>
        client.sendMessage.mock.calls.map((call: any[]) => call[2]?.[BOT_STATUS_KEY]?.state).filter(Boolean);
    const resting = { botId: BOT, name: 'Guide', enabled: false, aiProviderRef: 'p' };

    it('a resting bot says so in character once, adds the plain note, and keeps the message for later', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent(message('Are you around?'));
        expect(deps.reply).not.toHaveBeenCalled();
        expect(deps.restingLine).toHaveBeenCalledWith(resting, 'Are you around?');
        expect(client.sendText).toHaveBeenCalledWith(BOT_USER, ROOM, 'The ship is in the harbour, come back later!');
        expect(noteStates()).toEqual(['resting']);
        expect(client.sendMessage.mock.calls[0][2].body).toBe(
            "Guide is resting. The bot's owner turned it off for now, so it can't reply until it's back on."
        );

        // A second message soon after: no second AI line and no second note.
        await bridge.onEvent(message('Hello??'));
        expect(deps.restingLine).toHaveBeenCalledTimes(1);
        expect(noteStates()).toEqual(['resting']);

        // Back on: the bot answers the last message left in this chat, once.
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        await bridge.checkWaiting();
        expect(deps.reply).toHaveBeenCalledTimes(1);
        expect(deps.reply).toHaveBeenCalledWith(BOT, expect.anything(), 'Hello??', [], expect.anything());
        await bridge.checkWaiting();
        expect(deps.reply).toHaveBeenCalledTimes(1);
    });

    it('a resting line that comes back empty or fails to send is tried again on the next message', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        deps.restingLine.mockResolvedValueOnce('');
        await bridge.onEvent(message('Are you around?'));
        expect(client.sendText).not.toHaveBeenCalled();

        client.sendText.mockRejectedValueOnce(new Error('Synapse is busy'));
        await bridge.onEvent(message('Hello?'));
        expect(deps.restingLine).toHaveBeenCalledTimes(2);

        await bridge.onEvent(message('Hello??'));
        expect(deps.restingLine).toHaveBeenCalledTimes(3);
        expect(client.sendText).toHaveBeenLastCalledWith(BOT_USER, ROOM, 'The ship is in the harbour, come back later!');

        // Once a line got through, the bot stays quiet for a while.
        await bridge.onEvent(message('Still there?'));
        expect(deps.restingLine).toHaveBeenCalledTimes(3);
        expect(noteStates()).toEqual(['resting']);
    });

    it('sends the resting note again on the next message when it did not get through', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        client.sendMessage.mockRejectedValueOnce(new Error('Synapse is busy'));
        await bridge.onEvent(message('Are you around?'));
        await bridge.onEvent(message('Hello?'));
        expect(noteStates()).toEqual(['resting', 'resting']);

        // Once it got through, it waits before saying it again.
        await bridge.onEvent(message('Hello??'));
        expect(noteStates()).toEqual(['resting', 'resting']);
    });

    it('drops waiting messages older than a day, and checks with a fresh config', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent({ ...message('from yesterday'), origin_server_ts: Date.now() - 25 * 60 * 60 * 1000 });
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        await bridge.checkWaiting();
        expect(deps.getBotConfig).toHaveBeenCalledWith(BOT, true);
        expect(deps.reply).not.toHaveBeenCalled();
    });

    it('answers waiting messages as soon as someone else gets an answer', async () => {
        const OTHER_ROOM = '!dm2:matrix.test';
        client.getJoinedMembers.mockImplementation(async (_bot: string, room: string) => (room === OTHER_ROOM ? [BOB, BOT_USER] : [ALICE, BOT_USER]));
        deps.checkAccess.mockImplementation(async (_bot: string, sender: string) => ({
            allowed: true,
            reason: null,
            user: sender === BOB ? { uuid: 'uuid-bob', name: 'Bob', isGuest: false } : { uuid: 'uuid-alice', name: 'Alice', isGuest: false },
        }));
        await bridge.onEvent(invite());
        await bridge.onEvent(invite({ room_id: OTHER_ROOM, sender: BOB, event_id: '$i2' }));
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent(message('left while resting'));
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        await bridge.onEvent({ ...message('now?', BOB), room_id: OTHER_ROOM });
        await vi.waitFor(() => expect(deps.reply).toHaveBeenCalledTimes(2));
        expect(deps.reply.mock.calls.map((call: any[]) => call[2])).toEqual(['now?', 'left while resting']);
    });

    it('never answers a waiting message after a newer one from the same chat', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent(message('left while resting'));
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        await bridge.onEvent(message('now?'));
        await bridge.checkWaiting();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(deps.reply.mock.calls.map((call: any[]) => call[2])).toEqual(['now?']);
    });

    it('holds a waiting message while a newer one from the same chat is being answered, then passes it', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent({ ...message('left while resting'), origin_server_ts: Date.now() - 1000 });
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        let land!: (value: any) => void;
        deps.reply.mockImplementationOnce(() => new Promise((resolve) => (land = resolve)));
        const live = bridge.onEvent(message('now?'));
        await vi.waitFor(() => expect(deps.reply).toHaveBeenCalledTimes(1));
        // The regular check runs while the live answer is still on its way.
        await bridge.checkWaiting();
        expect(deps.reply).toHaveBeenCalledTimes(1);
        land({ text: 'Here now!', media: [] });
        await live;
        await bridge.checkWaiting();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(deps.reply.mock.calls.map((call: any[]) => call[2])).toEqual(['now?']);
    });

    it('answers the held message on the next check when the newer answer failed', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent({ ...message('left while resting'), origin_server_ts: Date.now() - 1000 });
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        let fail!: (error: Error) => void;
        deps.reply.mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = reject)));
        const live = bridge.onEvent(message('now?'));
        await vi.waitFor(() => expect(deps.reply).toHaveBeenCalledTimes(1));
        await bridge.checkWaiting();
        fail(new Error('model down'));
        await live;
        await bridge.checkWaiting();
        await vi.waitFor(() => expect(deps.reply).toHaveBeenCalledTimes(2));
        expect(deps.reply.mock.calls[1][2]).toBe('left while resting');
    });

    it('a waiting message still holds while the live answer clears its typing dots', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent({ ...message('left while resting'), origin_server_ts: Date.now() - 1000 });
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        // The answer takes long enough to show typing, and clearing it then hangs.
        deps.reply.mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve({ text: 'Here now!', media: [] }), 900)));
        let cleared!: () => void;
        client.setTyping.mockImplementation((_bot: string, _room: string, on: boolean) =>
            on ? Promise.resolve() : new Promise<void>((resolve) => (cleared = resolve))
        );
        const live = bridge.onEvent(message('now?'));
        await vi.waitFor(() => expect(cleared).toBeDefined(), { timeout: 2000 });
        await bridge.checkWaiting();
        cleared();
        await live;
        await bridge.checkWaiting();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(deps.reply.mock.calls.map((call: any[]) => call[2])).toEqual(['now?']);
    });

    it('on shutdown, puts back in line the waiting messages a drain took but had not started on', async () => {
        const OTHER_ROOM = '!dm2:matrix.test';
        const store = new Map<string, string>();
        deps.waiting = {
            hasSharedStore: () => true,
            rememberWaitingDm: vi.fn(async (_b: string, r: string, m: string) => void store.set(r, m)),
            waitingDmBots: vi.fn(async () => (store.size ? [BOT] : [])),
            hasWaitingDms: vi.fn(async () => store.size > 0),
            takeWaitingDms: vi.fn(async () => {
                const all = [...store.values()];
                store.clear();
                return all;
            }),
        };
        client.getJoinedMembers.mockImplementation(async (_bot: string, room: string) => (room === OTHER_ROOM ? [BOB, BOT_USER] : [ALICE, BOT_USER]));
        deps.checkAccess.mockImplementation(async (_bot: string, sender: string) => ({
            allowed: true,
            reason: null,
            user: sender === BOB ? { uuid: 'uuid-bob', name: 'Bob', isGuest: false } : { uuid: 'uuid-alice', name: 'Alice', isGuest: false },
        }));
        await bridge.onEvent(invite());
        await bridge.onEvent(invite({ room_id: OTHER_ROOM, sender: BOB, event_id: '$i2' }));
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent({ ...message('first'), origin_server_ts: Date.now() - 2000 });
        await bridge.onEvent({ ...message('second', BOB), room_id: OTHER_ROOM, origin_server_ts: Date.now() - 1000 });
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        let land!: (value: any) => void;
        deps.reply.mockImplementationOnce(() => new Promise((resolve) => (land = resolve)));
        const draining = bridge.checkWaiting();
        await vi.waitFor(() => expect(deps.reply).toHaveBeenCalledTimes(1));
        await bridge.stop();
        expect(store.get(OTHER_ROOM)).toContain('second');
        land({ text: 'Hi!', media: [] });
        await draining;
        expect(deps.reply.mock.calls.map((call: any[]) => call[2])).toEqual(['first']);
    });

    it('keeps waiting messages in the shared store when there is one', async () => {
        const store = new Map<string, string>();
        deps.waiting = {
            hasSharedStore: () => true,
            rememberWaitingDm: vi.fn(async (_b: string, r: string, m: string) => void store.set(r, m)),
            waitingDmBots: vi.fn(async () => (store.size ? [BOT] : [])),
            hasWaitingDms: vi.fn(async () => store.size > 0),
            takeWaitingDms: vi.fn(async () => {
                const all = [...store.values()];
                store.clear();
                return all;
            }),
        };
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent(message('saved for later'));
        expect(deps.waiting.rememberWaitingDm).toHaveBeenCalledWith(BOT, ROOM, expect.stringContaining('saved for later'));
        expect((bridge as any).localWaiting.size).toBe(0);
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        await bridge.checkWaiting();
        expect(deps.reply).toHaveBeenCalledWith(BOT, expect.anything(), 'saved for later', [], expect.anything());
    });

    it('a waiting message that fails to get an answer goes back in line, and the person hears only after the last try', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent(message('left while resting'));
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        deps.reply.mockResolvedValue({ text: '', media: [], failed: true });
        await bridge.checkWaiting();
        await bridge.checkWaiting();
        expect(deps.reply).toHaveBeenCalledTimes(2);
        expect(noteStates()).toEqual(['resting']);
        await bridge.checkWaiting();
        expect(deps.reply).toHaveBeenCalledTimes(3);
        expect(noteStates()).toEqual(['resting', 'trouble']);
        // Nothing is left waiting after the last try.
        await bridge.checkWaiting();
        expect(deps.reply).toHaveBeenCalledTimes(3);
    });

    it('a waiting message whose bot can\'t be loaded stays in line for the next check', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent(message('left while resting'));
        deps.getBotConfig.mockResolvedValueOnce({ ...resting, enabled: true } as never).mockRejectedValueOnce(new Error('Orbit down'));
        await bridge.checkWaiting();
        expect(deps.reply).not.toHaveBeenCalled();
        expect(noteStates()).toEqual(['resting']);
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        await bridge.checkWaiting();
        expect(deps.reply).toHaveBeenCalledWith(BOT, expect.anything(), 'left while resting', [], expect.anything());
    });

    it('a waiting message stays in line when Orbit cannot check access, and is answered once it can', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent(message('left while resting'));
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        (bridge as any).accessCache.clear();
        deps.checkAccess.mockResolvedValueOnce({ allowed: false, reason: 'admin_api_error', user: null });
        await bridge.checkWaiting();
        expect(deps.reply).not.toHaveBeenCalled();
        expect(noteStates()).toEqual(['resting']);
        await bridge.checkWaiting();
        expect(deps.reply).toHaveBeenCalledWith(BOT, expect.anything(), 'left while resting', [], expect.anything());
    });

    it('says it could not answer, not that you have no access, when Orbit cannot check, and asks Orbit again next time', async () => {
        await bridge.onEvent(invite());
        (bridge as any).accessCache.clear();
        deps.checkAccess.mockResolvedValueOnce({ allowed: false, reason: 'admin_api_status_500', user: null });
        await bridge.onEvent(message('hi'));
        expect(noteStates()).toEqual(['trouble']);
        expect(deps.reply).not.toHaveBeenCalled();
        await bridge.onEvent(message('hi again'));
        expect(deps.reply).toHaveBeenCalledWith(BOT, expect.anything(), 'hi again', [], expect.anything());
    });

    it('declines a new chat when Orbit cannot check access at the invite, and takes the next invite once it can', async () => {
        deps.checkAccess.mockResolvedValueOnce({ allowed: false, reason: 'admin_api_error', user: null });
        await bridge.onEvent(invite());
        expect(client.joinRoom).not.toHaveBeenCalled();
        expect(client.leaveRoom).toHaveBeenCalledWith(BOT_USER, ROOM);
        expect(noteStates()).toEqual([]);
        await bridge.onEvent(message('hello'));
        expect(deps.reply).not.toHaveBeenCalled();
        await bridge.onEvent(invite({ event_id: '$invite2' }));
        expect(client.joinRoom).toHaveBeenCalledWith(BOT_USER, ROOM);
        await bridge.onEvent(message('hello again'));
        expect(deps.reply).toHaveBeenCalledWith(BOT, expect.anything(), 'hello again', [], expect.anything());
    });

    it('in a chat it already has, a bot turned off shows Resting and keeps the last message', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent(message('first'));
        await bridge.onEvent(message('last'));
        expect(deps.reply).not.toHaveBeenCalled();
        expect(noteStates()).toEqual(['resting']);
        expect(client.leaveRoom).not.toHaveBeenCalled();
        const rooms: Map<string, { message: string }> = (bridge as any).localWaiting.get(BOT);
        expect(JSON.parse(rooms.get(ROOM)!.message).content.body).toBe('last');
        // The bot is back: the last message is answered, and Orbit is asked afresh, not answered from memory.
        deps.getBotConfig.mockResolvedValue({ botId: BOT, name: 'Guide', enabled: true, aiProviderRef: 'p' } as never);
        deps.checkAccess.mockClear();
        await bridge.checkWaiting();
        expect(deps.checkAccess).toHaveBeenCalled();
        expect(deps.reply).toHaveBeenCalledTimes(1);
        expect(deps.reply).toHaveBeenCalledWith(BOT, expect.anything(), 'last', [], expect.anything());
    });

    it('asks Orbit before the bot being off matters, so someone refused never learns it is resting', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        (bridge as any).accessCache.clear();
        deps.checkAccess.mockResolvedValue({ allowed: false, reason: 'not_allowed', user: null });
        await bridge.onEvent(message('are you there'));
        expect(noteStates()).toEqual(['limited']);
        expect((bridge as any).localWaiting.size).toBe(0);
    });

    it('tells someone the owner limits why, with its own note, and asks Orbit again once the answer is old', async () => {
        await bridge.onEvent(invite());
        (bridge as any).accessCache.clear();
        deps.checkAccess.mockResolvedValue({ allowed: false, reason: 'not_allowed', user: null });
        await bridge.onEvent(message('hello'));
        expect(noteStates()).toEqual(['limited']);
        expect(deps.reply).not.toHaveBeenCalled();
        const notice = client.sendMessage.mock.calls.map((call: any[]) => call[2]).find((content: any) => content?.['universe.bot_status']);
        expect(notice.body).toBe("Guide's owner limits who can message it.");
    });

    it('keeps nothing from a person Orbit refuses for any other reason, even while the bot is off', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        (bridge as any).accessCache.clear();
        for (const answer of [
            { allowed: false, reason: 'banned', user: null },
            { allowed: false, reason: 'no_room_access', user: null },
            { allowed: false, reason: 'unknown_person', user: null },
            { allowed: false, reason: 'shared_chat_id', user: null },
            { allowed: false, reason: 'not_allowed', user: null },
        ]) {
            deps.checkAccess.mockResolvedValue(answer);
            (bridge as any).accessCache.clear();
            await bridge.onEvent(message('let me in'));
        }
        expect((bridge as any).localWaiting.size).toBe(0);
        expect(noteStates()).toEqual(['no_access', 'limited']);
        expect(deps.reply).not.toHaveBeenCalled();
    });

    it('drops a waiting message when the person lost access while the bot rested', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent(message('left while resting'));
        expect((bridge as any).localWaiting.size).toBe(1);
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        deps.checkAccess.mockResolvedValue({ allowed: false, reason: 'banned', user: null });
        await bridge.checkWaiting();
        expect(deps.reply).not.toHaveBeenCalled();
        expect((bridge as any).localWaiting.size).toBe(0);
        expect(noteStates()).toEqual(['resting']);
    });

    it('leaves with the person even when the bot is resting, and drops what was waiting', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent(message('left while resting'));
        await bridge.onEvent({ type: 'm.room.member', room_id: ROOM, sender: ALICE, event_id: '$l', state_key: ALICE, content: { membership: 'leave' } });
        expect(client.leaveRoom).toHaveBeenCalledWith(BOT_USER, ROOM);
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        await bridge.checkWaiting();
        expect(deps.reply).not.toHaveBeenCalled();
    });

    it('declines a group invite without asking Orbit or the bot server', async () => {
        await bridge.onEvent(invite({}, { membership: 'invite', is_direct: false }));
        await bridge.onEvent(invite({ event_id: '$area' }, { membership: 'invite' }));
        expect(deps.checkAccess).not.toHaveBeenCalled();
        expect(deps.getBotConfig).not.toHaveBeenCalled();
        expect(client.joinRoom).not.toHaveBeenCalled();
        expect(client.leaveRoom).toHaveBeenCalledTimes(2);
    });

    it('runs one process-wide timer for waiting messages and none per bot or chat', async () => {
        vi.useFakeTimers();
        try {
            expect(vi.getTimerCount()).toBe(0);
            for (let i = 0; i < 5; i++) await bridge.onEvent(invite({ event_id: `$i${i}`, room_id: `!room${i}:matrix.test` }));
            expect(vi.getTimerCount()).toBe(0);
            bridge.start();
            bridge.start();
            expect(vi.getTimerCount()).toBe(1);
            // With nobody waiting, a check asks nobody anything.
            deps.getBotConfig.mockClear();
            await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
            expect(deps.getBotConfig).not.toHaveBeenCalled();
            await bridge.stop();
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('a waiting message keeps its failed tries when the bot rests again', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent(message('left while resting'));
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        deps.reply.mockResolvedValue({ text: '', media: [], failed: true });
        await bridge.checkWaiting();
        const kept = () => JSON.parse([...(bridge as any).localWaiting.get(BOT).values()][0].message);
        expect(kept().unsigned).toEqual({ universe_attempts: 1 });
        deps.getBotConfig.mockResolvedValueOnce({ ...resting, enabled: true } as never).mockResolvedValueOnce(resting as never);
        await bridge.checkWaiting();
        expect(kept().unsigned).toEqual({ universe_attempts: 1 });
    });

    it('a waiting message stays in line when the room store is unreachable, and is dropped once the chat is closed', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent(message('left while resting'));
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        (bridge as any).roomBots.clear();
        deps.rooms.getDmRoomBot.mockRejectedValueOnce(new Error('redis down'));
        await bridge.checkWaiting();
        expect(deps.reply).not.toHaveBeenCalled();
        expect((bridge as any).localWaiting.get(BOT)?.size).toBe(1);

        // The person left before the store came back: the message is dropped, not answered into an empty room.
        deps.rooms.getDmRoomBot.mockResolvedValueOnce(null);
        await bridge.checkWaiting();
        expect(deps.reply).not.toHaveBeenCalled();
        expect((bridge as any).localWaiting.has(BOT)).toBe(false);
    });

    it('keeps a waiting message in this process when the shared store drops out mid-write', async () => {
        deps.waiting = {
            hasSharedStore: () => true,
            rememberWaitingDm: vi.fn(async () => {
                throw new Error('Shared store is not connected');
            }),
            waitingDmBots: vi.fn(async () => []),
            hasWaitingDms: vi.fn(async () => false),
            takeWaitingDms: vi.fn(async () => []),
        };
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent(message('saved for later'));
        expect((bridge as any).localWaiting.get(BOT)?.size).toBe(1);
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        await bridge.checkWaiting();
        expect(deps.reply).toHaveBeenCalledWith(BOT, expect.anything(), 'saved for later', [], expect.anything());
    });

    it('the shared store refuses a waiting message it cannot keep, instead of dropping it', async () => {
        const { BotRegistry } = await import('../server/BotRegistry');
        await expect(new BotRegistry('test').rememberWaitingDm(BOT, ROOM, '{}')).rejects.toThrow('not connected');
    });

    it('a waiting picture that cannot be fetched goes back in line instead of being dropped', async () => {
        deps.uploadAttachment = vi.fn(async () => 'https://files.test/pic.png');
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        const picture: MatrixEvent = {
            ...message('pic.png'),
            content: { msgtype: 'm.image', body: 'pic.png', url: 'mxc://matrix.test/pic', info: { mimetype: 'image/png' } },
        };
        await bridge.onEvent(picture);
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        client.downloadMedia.mockRejectedValueOnce(new Error('media busy'));
        await bridge.checkWaiting();
        expect(deps.reply).not.toHaveBeenCalled();
        expect((bridge as any).localWaiting.get(BOT)?.size).toBe(1);
        await bridge.checkWaiting();
        expect(deps.reply).toHaveBeenCalledWith(BOT, expect.anything(), '', [expect.objectContaining({ mediaType: 'image' })], expect.anything());
    });

    it('a message kept here while the shared store was down is replaced by a newer one in the store, so it is answered once', async () => {
        const store = new Map<string, string>();
        let storeUp = false;
        deps.waiting = {
            hasSharedStore: () => true,
            rememberWaitingDm: vi.fn(async (_b: string, r: string, m: string) => {
                if (!storeUp) throw new Error('Shared store is not connected');
                store.set(r, m);
            }),
            waitingDmBots: vi.fn(async () => (store.size ? [BOT] : [])),
            hasWaitingDms: vi.fn(async () => store.size > 0),
            takeWaitingDms: vi.fn(async () => {
                const all = [...store.values()];
                store.clear();
                return all;
            }),
        };
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent(message('first'));
        storeUp = true;
        await bridge.onEvent(message('second'));
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        await bridge.checkWaiting();
        expect(deps.reply.mock.calls.map((call: any[]) => call[2])).toEqual(['second']);
    });

    it('a chat with one waiting message in the store and a newer one kept here is answered once, with the newer', async () => {
        const store = new Map<string, string>();
        let storeUp = true;
        deps.waiting = {
            hasSharedStore: () => true,
            rememberWaitingDm: vi.fn(async (_b: string, r: string, m: string) => {
                if (!storeUp) throw new Error('Shared store is not connected');
                store.set(r, m);
            }),
            waitingDmBots: vi.fn(async () => (store.size ? [BOT] : [])),
            hasWaitingDms: vi.fn(async () => store.size > 0),
            takeWaitingDms: vi.fn(async () => {
                const all = [...store.values()];
                store.clear();
                return all;
            }),
        };
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent(message('first'));
        storeUp = false;
        await bridge.onEvent(message('second'));
        storeUp = true;
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        await bridge.checkWaiting();
        expect(deps.reply.mock.calls.map((call: any[]) => call[2])).toEqual(['second']);
    });

    it('says it could not answer instead of going silent when no reply could be made', async () => {
        await bridge.onEvent(invite());
        deps.reply.mockResolvedValueOnce(null);
        await bridge.onEvent(message('hello?'));
        expect(noteStates()).toEqual(['trouble']);
    });

    it('says it could not answer a picture it has nowhere to put, instead of going silent', async () => {
        const picture: MatrixEvent = {
            ...message('pic.png'),
            content: { msgtype: 'm.image', body: 'pic.png', url: 'mxc://matrix.test/pic', info: { mimetype: 'image/png' } },
        };
        await bridge.onEvent(invite());
        deps.uploadAttachment = vi.fn(async () => null);
        await bridge.onEvent(picture);
        deps.uploadAttachment = undefined as never;
        await bridge.onEvent({ ...picture, event_id: '$pic2' });
        expect(deps.reply).not.toHaveBeenCalled();
        expect(noteStates()).toEqual(['trouble', 'trouble']);
    });

    it('messages typed before the bot joined get one "couldn\'t answer" note between them when answering fails', async () => {
        const early = (body: string, ts: number): MatrixEvent => ({ ...message(body), origin_server_ts: ts });
        client.getRecentMessages.mockResolvedValueOnce([early('hi', 2000), early('anyone there?', 2100), early('hello??', 2200)]);
        deps.reply.mockResolvedValue({ text: '', media: [], failed: true });
        await bridge.onEvent(invite({ origin_server_ts: 1500 }));
        expect(deps.reply).toHaveBeenCalledTimes(3);
        expect(noteStates()).toEqual(['trouble']);
        // A message sent afterwards is its own try, so it gets its own note.
        await bridge.onEvent(message('again'));
        expect(noteStates()).toEqual(['trouble', 'trouble']);
    });

    it('says it could not answer when the reply comes back empty, and tries a waiting message again', async () => {
        await bridge.onEvent(invite());
        deps.reply.mockResolvedValue({ text: '', media: [] });
        await bridge.onEvent(message('hello?'));
        expect(noteStates()).toEqual(['trouble']);
        expect(client.sendText).not.toHaveBeenCalled();

        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent(message('left while resting'));
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        await bridge.checkWaiting();
        // The first empty answer to a waiting message is tried again later, not reported.
        expect(noteStates()).toEqual(['trouble', 'resting']);
        expect((bridge as any).localWaiting.get(BOT)?.size).toBe(1);
    });

    it('keeps the answer only after it reached the chat', async () => {
        const keep = vi.fn();
        deps.reply.mockResolvedValue({ text: 'Hello Alice!', media: [], keep });
        await bridge.onEvent(invite());
        client.sendText.mockRejectedValueOnce(new Error('Synapse is busy'));
        await bridge.onEvent(message('hi'));
        expect(keep).not.toHaveBeenCalled();
        await bridge.onEvent(message('hi again'));
        expect(keep).toHaveBeenCalledTimes(1);
    });

    it('a bot with no AI provider leaves one "not ready" note instead of silence', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue({ botId: BOT, name: 'Guide', enabled: true } as never);
        await bridge.onEvent(message('Hi!'));
        await bridge.onEvent(message('Hello??'));
        expect(deps.reply).not.toHaveBeenCalled();
        expect(noteStates()).toEqual(['unready']);
    });

    it('says the problem is on our side when the AI fails, the reply throws, or Orbit is down', async () => {
        await bridge.onEvent(invite());
        deps.reply.mockResolvedValueOnce({ text: '', media: [], failed: true });
        await bridge.onEvent(message('Tell me about the island'));
        deps.reply.mockRejectedValueOnce(new Error('boom'));
        await bridge.onEvent(message('again'));
        deps.getBotConfig.mockRejectedValueOnce(new Error('orbit down'));
        await bridge.onEvent(message('and again'));
        expect(noteStates()).toEqual(['trouble', 'trouble', 'trouble']);
        expect(client.sendMessage.mock.calls[0][2].body).toBe("Guide couldn't answer that just now. Send it again in a minute.");
        expect(client.sendText).not.toHaveBeenCalled();
    });

    /** Moves the clock past the spacing between two "no such bot" answers that count. */
    const aMinuteLater = () => vi.setSystemTime(Date.now() + 61_000);

    it("shows a bot Orbit can't find as gone only once that is confirmed, and forgets the misses on a real answer", async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            const config = { botId: BOT, name: 'Guide', enabled: true, aiProviderRef: 'p' } as never;
            // Orbit restarting can answer "not found" for a minute or two: the chat must not read as closed.
            expect(bridge.availability(BOT, null)).toBe('unknown');
            aMinuteLater();
            expect(bridge.availability(BOT, null)).toBe('unknown');
            expect(bridge.availability(BOT, config)).toBe('online');
            aMinuteLater();
            expect(bridge.availability(BOT, null)).toBe('unknown');
            aMinuteLater();
            expect(bridge.availability(BOT, null)).toBe('unknown');
            aMinuteLater();
            expect(bridge.availability(BOT, null)).toBe('gone');
        } finally {
            vi.useRealTimers();
        }
    });

    it('a deleted bot says goodbye once Orbit has said so three times a minute apart, then leaves and forgets the chat', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            await bridge.onEvent(invite());
            deps.getBotConfig.mockResolvedValue(null as never);
            await bridge.onEvent(message('Hello?'));
            await bridge.onEvent(message('Hello??'));
            aMinuteLater();
            await bridge.onEvent(message('Still there?'));
            // Orbit restarting can answer "not found": until it has said so three times, the person hears "try again".
            expect(noteStates()).toEqual(['trouble', 'trouble', 'trouble']);
            expect(client.leaveRoom).not.toHaveBeenCalled();
            aMinuteLater();
            await bridge.onEvent(message('Anyone?'));
            expect(noteStates()).toEqual(['trouble', 'trouble', 'trouble', 'gone']);
            expect(client.sendMessage.mock.calls.at(-1)[2].body).toBe(
                "Guide isn't around anymore. The bot was removed, so this chat is closed."
            );
            expect(client.leaveRoom).toHaveBeenCalledWith(BOT_USER, ROOM);
            expect(deps.rooms!.forgetDmRoom).toHaveBeenCalledWith(ROOM);
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps the chat when Orbit answers again after saying "not found", and starts counting afresh', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            await bridge.onEvent(invite());
            deps.getBotConfig.mockResolvedValue(null as never);
            await bridge.onEvent(message('one'));
            aMinuteLater();
            await bridge.onEvent(message('two'));
            deps.getBotConfig.mockResolvedValue({ botId: BOT, name: 'Guide', enabled: true, aiProviderRef: 'p' } as never);
            await bridge.onEvent(message('three'));
            expect(deps.reply).toHaveBeenCalledTimes(1);
            deps.getBotConfig.mockResolvedValue(null as never);
            aMinuteLater();
            await bridge.onEvent(message('four'));
            expect(client.leaveRoom).not.toHaveBeenCalled();
            expect(noteStates()).toEqual(['trouble', 'trouble', 'trouble']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('a bot deleted while someone waits says goodbye to them and leaves, without waiting for another message', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue({ botId: BOT, name: 'Guide', enabled: false } as never);
        await bridge.onEvent(message('Hola, ¿estás ahí?'));
        deps.getBotConfig.mockResolvedValue(null as never);
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            await bridge.checkWaiting();
            aMinuteLater();
            await bridge.checkWaiting();
            // Not sure yet: the message keeps waiting and nobody is told anything new.
            expect(noteStates()).toEqual(['resting']);
            expect(client.leaveRoom).not.toHaveBeenCalled();
            aMinuteLater();
            await bridge.checkWaiting();
        } finally {
            vi.useRealTimers();
        }
        expect(noteStates()).toEqual(['resting', 'gone']);
        expect(client.sendMessage.mock.calls.at(-1)[2][BOT_STATUS_KEY].lang).toBe('es');
        expect(client.leaveRoom).toHaveBeenCalledWith(BOT_USER, ROOM);
        expect(deps.rooms!.forgetDmRoom).toHaveBeenCalledWith(ROOM);
        expect(deps.reply).not.toHaveBeenCalled();
    });

    it('forgets the chat when the bot is removed from it after a restart', async () => {
        await bridge.onEvent(invite());
        const restarted = new MatrixDmBridge(config, client as never, deps);
        await restarted.onEvent({ type: 'm.room.member', room_id: ROOM, sender: ALICE, event_id: '$kick', state_key: BOT_USER, content: { membership: 'leave' } });
        expect(deps.rooms!.forgetDmRoom).toHaveBeenCalledWith(ROOM);
    });

    it('a message whose room members cannot be read gets a note now, or goes back in line when it was waiting', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue({ botId: BOT, name: 'Guide', enabled: false } as never);
        await bridge.onEvent(message('left while resting'));
        deps.getBotConfig.mockResolvedValue({ botId: BOT, name: 'Guide', enabled: true, aiProviderRef: 'p' } as never);
        (bridge as any).roomMembers.clear();
        client.getJoinedMembers.mockRejectedValueOnce(new Error('synapse busy'));
        await bridge.checkWaiting();
        expect(deps.reply).not.toHaveBeenCalled();
        expect((bridge as any).localWaiting.get(BOT)?.size).toBe(1);
        await bridge.checkWaiting();
        expect(deps.reply).toHaveBeenCalledWith(BOT, expect.anything(), 'left while resting', [], expect.anything());

        (bridge as any).roomMembers.clear();
        client.getJoinedMembers.mockRejectedValueOnce(new Error('synapse busy'));
        await bridge.onEvent(message('live one'));
        expect(noteStates().at(-1)).toBe('trouble');
    });

    it('names a deleted bot from its Matrix profile after a restart', async () => {
        await bridge.onEvent(invite());
        const restarted = new MatrixDmBridge(config, client as never, deps);
        client.getDisplayName.mockResolvedValue('Captain Mira');
        deps.getBotConfig.mockResolvedValue(null as never);
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            await restarted.onEvent(message('Hello?'));
            aMinuteLater();
            await restarted.onEvent(message('Hello??'));
            aMinuteLater();
            await restarted.onEvent(message('Hello???'));
        } finally {
            vi.useRealTimers();
        }
        expect(client.getDisplayName).toHaveBeenCalledWith(BOT_USER);
        expect(client.sendMessage.mock.calls.at(-1)[2].body).toContain('Captain Mira');
    });

    it('writes the note in the language of the message', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent(message('مرحبا، هل أنت موجودة؟'));
        const note = client.sendMessage.mock.calls[0][2];
        expect(note[BOT_STATUS_KEY]).toMatchObject({ state: 'resting', lang: 'ar', title: 'في استراحة' });
    });

    it('keeps typing showing through a long answer', async () => {
        vi.useFakeTimers();
        try {
            let finish: (v: unknown) => void = () => undefined;
            deps.reply.mockImplementationOnce(() => new Promise((r) => (finish = r)));
            await bridge.onEvent(invite());
            const pending = bridge.onEvent(message('write me an essay'));
            await vi.advanceTimersByTimeAsync(45000);
            const typingOn = client.setTyping.mock.calls.filter((call: any[]) => call[2] === true).length;
            expect(typingOn).toBeGreaterThanOrEqual(3);
            finish({ text: 'Done.', media: [] });
            await pending;
            const after = client.setTyping.mock.calls.length;
            await vi.advanceTimersByTimeAsync(60000);
            expect(client.setTyping.mock.calls.length).toBe(after);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('Matrix application service routes', () => {
    let server: Server;
    let base: string;
    const handler = { onEvent: vi.fn(async (_event: MatrixEvent): Promise<void> => undefined), userExists: vi.fn(async (u: string) => u === BOT_USER) };

    beforeAll(async () => {
        const app = express();
        app.use(createMatrixAppServiceRouter(config, handler));
        app.use(express.json());
        app.get('/health', (_req, res) => {
            res.json({ ok: true });
        });
        server = await new Promise<Server>((resolve) => {
            const s = app.listen(0, () => resolve(s));
        });
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
    beforeEach(() => vi.clearAllMocks());

    const put = (path: string, body: unknown, token?: string) =>
        fetch(`${base}${path}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify(body),
        });

    it('refuses anyone without the homeserver token', async () => {
        expect((await put('/_matrix/app/v1/transactions/1', { events: [] })).status).toBe(403);
        expect((await put('/_matrix/app/v1/transactions/1', { events: [] }, 'as-secret')).status).toBe(403);
        expect((await fetch(`${base}/_matrix/app/v1/users/${encodeURIComponent(BOT_USER)}`)).status).toBe(403);
        expect(handler.onEvent).not.toHaveBeenCalled();
    });

    it('reads no body before the token is checked', async () => {
        const response = await fetch(`${base}/_matrix/app/v1/transactions/2`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: '{not json',
        });
        // Parsed first, this would be a 400 for the broken body.
        expect(response.status).toBe(403);
    });

    it('keeps one room in order while other rooms run alongside it', async () => {
        const order: string[] = [];
        let releaseSlow: () => void = () => undefined;
        handler.onEvent.mockImplementation(async (e: MatrixEvent) => {
            if (e.content.body === 'slow') await new Promise<void>((r) => (releaseSlow = r));
            order.push(`${e.room_id}:${e.content.body}`);
        });
        const slow = { ...message('slow'), room_id: '!a' };
        const afterSlow = { ...message('after'), room_id: '!a' };
        const other = { ...message('other'), room_id: '!b' };
        await put('/_matrix/app/v1/transactions/order', { events: [slow, afterSlow, other] }, 'hs-secret');
        await new Promise((r) => setTimeout(r, 20));
        expect(order).toEqual(['!b:other']);
        releaseSlow();
        await new Promise((r) => setTimeout(r, 20));
        expect(order).toEqual(['!b:other', '!a:slow', '!a:after']);
        handler.onEvent.mockImplementation(async () => undefined);
    });

    it('hands each event over once, even when Synapse retries a transaction', async () => {
        const events = [message('a'), message('b')];
        expect((await put('/_matrix/app/v1/transactions/t1', { events }, 'hs-secret')).status).toBe(200);
        expect((await put('/_matrix/app/v1/transactions/t1', { events }, 'hs-secret')).status).toBe(200);
        await new Promise((r) => setTimeout(r, 20));
        expect(handler.onEvent).toHaveBeenCalledTimes(2);
    });

    it('answers user queries for bots only, and leaves other routes alone', async () => {
        const auth = { headers: { Authorization: 'Bearer hs-secret' } };
        expect((await fetch(`${base}/_matrix/app/v1/users/${encodeURIComponent(BOT_USER)}`, auth)).status).toBe(200);
        expect((await fetch(`${base}/_matrix/app/v1/users/${encodeURIComponent(ALICE)}`, auth)).status).toBe(404);
        expect((await fetch(`${base}/health`)).status).toBe(200);
    });
});

describe('DmReplyService ids', () => {
    it('gives each person a stable negative id and forgets the least recent once full', async () => {
        const { DmReplyService } = await import('../server/DmReplyService');
        const service = Object.create(DmReplyService.prototype) as InstanceType<typeof DmReplyService>;
        Object.assign(service, { playerIds: new Map(), nextPlayerId: -1 });
        const first = service.playerIdFor('@p0:matrix.test');
        expect(first).toBeLessThan(0);
        expect(service.playerIdFor('@p0:matrix.test')).toBe(first);
        for (let i = 1; i <= 10000; i++) service.playerIdFor(`@p${i}:matrix.test`);
        const ids: Map<string, number> = (service as any).playerIds;
        expect(ids.size).toBe(10000);
        expect(ids.has('@p0:matrix.test')).toBe(false);
        expect(service.playerIdFor('@p0:matrix.test')).not.toBe(first);
    });
});

describe('DmReplyService history', () => {
    it('keeps a message tried again after a failed answer once in the history, and never in the conversation log', async () => {
        const { DmReplyService } = await import('../server/DmReplyService');
        const { ConversationMemory } = await import('../memory/ConversationMemory');
        const service = Object.create(DmReplyService.prototype) as InstanceType<typeof DmReplyService>;
        const memory = new ConversationMemory();
        const storage = { startConversation: vi.fn(), addMessage: vi.fn(async () => undefined) };
        const failing = vi.fn(async function* () {
            throw new Error('provider down');
        });
        Object.assign(service, {
            playerIds: new Map(),
            nextPlayerId: -1,
            loadedBots: new Set([BOT]),
            botManager: { getBot: () => null },
            getBotConfig: async () => ({ botId: BOT, name: 'Guide', aiProviderRef: 'p' }),
            aiService: { generateBotResponseStream: failing },
            conversationMemory: memory,
            conversationStorage: storage,
        });
        const person = { matrixUserId: ALICE, uuid: 'uuid-alice', name: 'Alice', isGuest: false };
        expect(await (service as any).replyNow(BOT, person, 'left while resting', [], {})).toEqual({ text: '', media: [], failed: true });
        expect(await (service as any).replyNow(BOT, person, 'left while resting', [], {})).toEqual({ text: '', media: [], failed: true });
        const history = memory.getMemory(BOT, service.playerIdFor(ALICE))!.conversationHistory;
        expect(history.map((entry) => entry.message)).toEqual(['left while resting']);
        // A direct message stays out of the log the bot's managers read.
        expect(storage.startConversation).not.toHaveBeenCalled();
        expect(storage.addMessage).not.toHaveBeenCalled();
        // Something new is kept as usual.
        await (service as any).replyNow(BOT, person, 'are you back?', [], {});
        expect(history.map((entry) => entry.message)).toEqual(['left while resting', 'are you back?']);
    });

    it("names a first-time person by their uuid before the model or its tools see them", async () => {
        const { DmReplyService } = await import('../server/DmReplyService');
        const { PersistentMemory } = await import('../memory/PersistentMemory');
        const service = Object.create(DmReplyService.prototype) as InstanceType<typeof DmReplyService>;
        const memory = new PersistentMemory({});
        let uuidSeen: string | undefined;
        const answering = vi.fn(async function* () {
            uuidSeen = memory.getMemory(BOT, service.playerIdFor(ALICE))?.userUuid;
            yield { content: 'Hello Alice!', done: true };
        });
        Object.assign(service, {
            playerIds: new Map(),
            nextPlayerId: -1,
            loadedBots: new Set([BOT]),
            botManager: { getBot: () => null },
            getBotConfig: async () => ({ botId: BOT, name: 'Guide', aiProviderRef: 'p' }),
            aiService: { generateBotResponseStream: answering },
            conversationMemory: memory,
            conversationStorage: { startConversation: vi.fn(), addMessage: vi.fn(async () => undefined) },
        });
        const person = { matrixUserId: ALICE, uuid: 'uuid-alice', name: 'Alice', isGuest: false };
        await (service as any).replyNow(BOT, person, 'hi, first time here', [], {});
        expect(uuidSeen).toBe('uuid-alice');
    });

    it("tells the model which room the bot lives in, so it can name it", async () => {
        const { DmReplyService } = await import('../server/DmReplyService');
        const { PersistentMemory } = await import('../memory/PersistentMemory');
        const service = Object.create(DmReplyService.prototype) as InstanceType<typeof DmReplyService>;
        const room = 'https://play.example/@/bawes/hq/lobby';
        const answering = vi.fn(async function* () {
            yield { content: 'I live in the Lobby.', done: true };
        });
        Object.assign(service, {
            playerIds: new Map(),
            nextPlayerId: -1,
            loadedBots: new Set([BOT]),
            botManager: { getBot: () => null },
            getBotConfig: async () => ({ botId: BOT, name: 'Guide', aiProviderRef: 'p', roomUrl: room }),
            aiService: { generateBotResponseStream: answering },
            conversationMemory: new PersistentMemory({}),
            conversationStorage: { startConversation: vi.fn(), addMessage: vi.fn(async () => undefined) },
        });
        const person = { matrixUserId: ALICE, uuid: 'uuid-alice', name: 'Alice', isGuest: false };
        await (service as any).replyNow(BOT, person, 'where u at', [], {});
        const args = answering.mock.calls[0] as unknown[];
        expect(args[11]).toBe('dm');
        expect(args[13]).toBe(room);
        // Not on the map right now, so it can't tell who is in its room.
        expect(args[14]).toBeNull();
    });

    it("tells the model who is in the bot's room, as its bubble on the map sees them, and links the room it names", async () => {
        const { DmReplyService } = await import('../server/DmReplyService');
        const { PersistentMemory } = await import('../memory/PersistentMemory');
        const { BotClient } = await import('../client/BotClient');
        const service = Object.create(DmReplyService.prototype) as InstanceType<typeof DmReplyService>;
        const room = 'https://play.example/@/bawes/hq/lobby';
        const answering = vi.fn(async function* () {
            yield { content: 'I live in the Lobby at BAWES HQ. Khalid is here too.', done: true };
        });
        const otherBot = 98765;
        (BotClient as any).botUserIds.add(otherBot);
        const live = {
            isConnected: () => true,
            getAllPeople: () => [
                { userId: 1, name: 'Khalid' },
                { userId: otherBot, name: 'Other bot' },
                { userId: 2, name: '' },
            ],
        };
        Object.assign(service, {
            playerIds: new Map(),
            nextPlayerId: -1,
            loadedBots: new Set([BOT]),
            botManager: { getBot: () => live },
            roomCards: new Map(),
            adminApiService: { getRoomMetadata: vi.fn(async () => ({ universeName: 'BAWES', worldName: 'BAWES HQ', roomName: 'Lobby' })) },
            getBotConfig: async () => ({ botId: BOT, name: 'Guide', aiProviderRef: 'p', roomUrl: room }),
            aiService: { generateBotResponseStream: answering },
            conversationMemory: new PersistentMemory({}),
            conversationStorage: { startConversation: vi.fn(), addMessage: vi.fn(async () => undefined) },
        });
        const person = { matrixUserId: ALICE, uuid: 'uuid-alice', name: 'Alice', isGuest: false };
        const reply = await (service as any).replyNow(BOT, person, "who's around?", [], {});
        (BotClient as any).botUserIds.delete(otherBot);
        expect((answering.mock.calls[0] as unknown[])[14]).toEqual(['Khalid', 'User 2']);
        expect(reply.roomLink).toEqual({ url: room, room: 'Lobby', world: 'BAWES HQ', universe: 'BAWES' });
    });

    it("gives a bot's room for its profile, and nothing for a bot without one", async () => {
        const { DmReplyService } = await import('../server/DmReplyService');
        const service = Object.create(DmReplyService.prototype) as InstanceType<typeof DmReplyService>;
        const room = 'https://play.example/@/bawes/hq/lobby';
        const configs: Record<string, unknown> = { [BOT]: { botId: BOT, roomUrl: room }, roomless: { botId: 'roomless' } };
        Object.assign(service, {
            adminApiService: { getRoomMetadata: vi.fn(async () => ({ universeName: 'BAWES', worldName: 'BAWES HQ', roomName: 'Lobby' })) },
            getBotConfig: async (botId: string) => configs[botId] ?? null,
        });
        expect(await service.roomOf(BOT)).toEqual({ url: room, room: 'Lobby', world: 'BAWES HQ', universe: 'BAWES' });
        expect(await service.roomOf('roomless')).toBeUndefined();
        expect(await service.roomOf('missing')).toBeUndefined();
    });

    it('counts an answer the provider broke off as failed, so it is never sent cut short', async () => {
        const { DmReplyService } = await import('../server/DmReplyService');
        const { PersistentMemory } = await import('../memory/PersistentMemory');
        const service = Object.create(DmReplyService.prototype) as InstanceType<typeof DmReplyService>;
        const memory = new PersistentMemory({});
        const brokenOff = vi.fn(async function* () {
            yield { content: 'The Library is just past the', done: false };
            yield { content: '', done: true, metadata: { tokensUsed: 0, latency: 5, error: true } };
        });
        Object.assign(service, {
            playerIds: new Map(),
            nextPlayerId: -1,
            loadedBots: new Set([BOT]),
            botManager: { getBot: () => null },
            getBotConfig: async () => ({ botId: BOT, name: 'Guide', aiProviderRef: 'p' }),
            aiService: { generateBotResponseStream: brokenOff },
            conversationMemory: memory,
            conversationStorage: { startConversation: vi.fn(), addMessage: vi.fn(async () => undefined) },
        });
        const person = { matrixUserId: ALICE, uuid: 'uuid-alice', name: 'Alice', isGuest: false };
        expect(await (service as any).replyNow(BOT, person, 'where is the library?', [], {})).toEqual({ text: '', media: [], failed: true });
        const history = memory.getMemory(BOT, service.playerIdFor(ALICE))!.conversationHistory;
        expect(history.map((entry) => entry.sender)).toEqual(['person']);
    });

    it('drops media a failed turn made, so it never rides along with the next answer', async () => {
        const { DmReplyService } = await import('../server/DmReplyService');
        const { PersistentMemory } = await import('../memory/PersistentMemory');
        const service = Object.create(DmReplyService.prototype) as InstanceType<typeof DmReplyService>;
        const memory = new PersistentMemory({});
        const picture = { url: 'https://cdn.test/map.png', mediaType: 'image' as const, mimeType: 'image/png', createdAt: Date.now(), retryCount: 0 };
        let turn = 0;
        const stream = vi.fn(async function* () {
            turn++;
            if (turn === 1) {
                // A tool made a picture, then the provider broke off.
                memory.getMemory(BOT, service.playerIdFor(ALICE))!.pendingMedia = [picture];
                yield { content: 'Here is the', done: false };
                yield { content: '', done: true, metadata: { tokensUsed: 0, latency: 5, error: true } };
                return;
            }
            yield { content: 'Hello Alice!', done: true, metadata: { tokensUsed: 0, latency: 5 } };
        });
        Object.assign(service, {
            playerIds: new Map(),
            nextPlayerId: -1,
            loadedBots: new Set([BOT]),
            botManager: { getBot: () => null },
            getBotConfig: async () => ({ botId: BOT, name: 'Guide', aiProviderRef: 'p' }),
            aiService: { generateBotResponseStream: stream },
            conversationMemory: memory,
            conversationStorage: { startConversation: vi.fn(), addMessage: vi.fn(async () => undefined) },
        });
        const person = { matrixUserId: ALICE, uuid: 'uuid-alice', name: 'Alice', isGuest: false };
        expect(await (service as any).replyNow(BOT, person, 'show me the map', [], {})).toEqual({ text: '', media: [], failed: true });
        const next = await (service as any).replyNow(BOT, person, 'hi', [], {});
        expect(next.text).toBe('Hello Alice!');
        expect(next.media).toEqual([]);
    });

    it('cards a passing mention of the room once a day, and every answer to where the bot is', async () => {
        const { DmReplyService } = await import('../server/DmReplyService');
        const { PersistentMemory } = await import('../memory/PersistentMemory');
        const service = Object.create(DmReplyService.prototype) as InstanceType<typeof DmReplyService>;
        const replies = [
            'Back in the Lobby I keep a list of those.',
            'The Lobby has a good view of it too.',
            "I'm in the Lobby at BAWES HQ, come find me! [ROOM_CARD]",
            'Come over [room_card]',
        ];
        const answering = vi.fn(async function* () {
            yield { content: replies.shift()!, done: true };
        });
        Object.assign(service, {
            playerIds: new Map(),
            nextPlayerId: -1,
            loadedBots: new Set([BOT]),
            roomCards: new Map(),
            botManager: { getBot: () => null },
            adminApiService: { getRoomMetadata: vi.fn(async () => ({ universeName: 'BAWES', worldName: 'BAWES HQ', roomName: 'Lobby' })) },
            getBotConfig: async () => ({ botId: BOT, name: 'Guide', aiProviderRef: 'p', roomUrl: 'https://play.example/@/bawes/hq/lobby' }),
            aiService: { generateBotResponseStream: answering },
            conversationMemory: new PersistentMemory({}),
            conversationStorage: { startConversation: vi.fn(), addMessage: vi.fn(async () => undefined) },
        });
        const person = { matrixUserId: ALICE, uuid: 'uuid-alice', name: 'Alice', isGuest: false };
        const ask = (text: string) => (service as any).replyNow(BOT, person, text, [], {});
        // In passing: the first mention gets a card, the next one that day does not.
        expect((await ask('any tips?')).roomLink?.room).toBe('Lobby');
        expect((await ask('and the view?')).roomLink).toBeUndefined();
        // Asked where it is: the card comes every time, and the mark never shows.
        const where = await ask('where are you?');
        expect(where.roomLink?.room).toBe('Lobby');
        expect(where.text).toBe("I'm in the Lobby at BAWES HQ, come find me!");
        const meet = await ask('can we meet?');
        expect(meet.roomLink?.room).toBe('Lobby');
        expect(meet.text).toBe('Come over');
    });

    it('goes by the mark of the reply that is sent, when a repeated answer was asked for again', async () => {
        const { DmReplyService } = await import('../server/DmReplyService');
        const { PersistentMemory } = await import('../memory/PersistentMemory');
        const service = Object.create(DmReplyService.prototype) as InstanceType<typeof DmReplyService>;
        const answering = vi.fn(async function* () {
            yield { content: "I'm in the Lobby, come find me! [ROOM_CARD]", done: true };
        });
        Object.assign(service, {
            playerIds: new Map(),
            nextPlayerId: -1,
            loadedBots: new Set([BOT]),
            roomCards: new Map(),
            botManager: { getBot: () => null },
            adminApiService: { getRoomMetadata: vi.fn(async () => ({ universeName: 'BAWES', worldName: 'BAWES HQ', roomName: 'Lobby' })) },
            getBotConfig: async () => ({ botId: BOT, name: 'Guide', aiProviderRef: 'p', roomUrl: 'https://play.example/@/bawes/hq/lobby' }),
            aiService: { generateBotResponseStream: answering },
            responseProcessor: { processResponse: (_b: string, _p: number, text: string) => ({ cleaned: text }) },
            regenerateOnRepetition: vi.fn(async () => ({ processedMessage: 'Happy to help with that.' })),
            conversationMemory: new PersistentMemory({}),
            conversationStorage: { startConversation: vi.fn(), addMessage: vi.fn(async () => undefined) },
        });
        const person = { matrixUserId: ALICE, uuid: 'uuid-alice', name: 'Alice', isGuest: false };
        const reply = await (service as any).replyNow(BOT, person, 'where are you?', [], {});
        expect(reply.text).toBe('Happy to help with that.');
        expect(reply.roomLink).toBeUndefined();
    });

    it('adds no room link to a reply that does not name the room', async () => {
        const { DmReplyService } = await import('../server/DmReplyService');
        const { PersistentMemory } = await import('../memory/PersistentMemory');
        const service = Object.create(DmReplyService.prototype) as InstanceType<typeof DmReplyService>;
        const answering = vi.fn(async function* () {
            yield { content: 'Hello there!', done: true };
        });
        Object.assign(service, {
            playerIds: new Map(),
            nextPlayerId: -1,
            loadedBots: new Set([BOT]),
            botManager: { getBot: () => null },
            roomCards: new Map(),
            adminApiService: { getRoomMetadata: vi.fn(async () => ({ universeName: 'BAWES', worldName: 'BAWES HQ', roomName: 'Lobby' })) },
            getBotConfig: async () => ({ botId: BOT, name: 'Guide', aiProviderRef: 'p', roomUrl: 'https://play.example/@/bawes/hq/lobby' }),
            aiService: { generateBotResponseStream: answering },
            conversationMemory: new PersistentMemory({}),
            conversationStorage: { startConversation: vi.fn(), addMessage: vi.fn(async () => undefined) },
        });
        const person = { matrixUserId: ALICE, uuid: 'uuid-alice', name: 'Alice', isGuest: false };
        const reply = await (service as any).replyNow(BOT, person, 'hi', [], {});
        expect(reply.roomLink).toBeUndefined();
    });

    it('remembers an answer only once it was sent, so a retry after a failed send is answered afresh', async () => {
        const { DmReplyService } = await import('../server/DmReplyService');
        const { ConversationMemory } = await import('../memory/ConversationMemory');
        const service = Object.create(DmReplyService.prototype) as InstanceType<typeof DmReplyService>;
        const memory = new ConversationMemory();
        const storage = { startConversation: vi.fn(), addMessage: vi.fn(async () => undefined) };
        const answering = vi.fn(async function* () {
            yield { content: 'Hello Alice!', done: true };
        });
        Object.assign(service, {
            playerIds: new Map(),
            nextPlayerId: -1,
            loadedBots: new Set([BOT]),
            botManager: { getBot: () => null },
            getBotConfig: async () => ({ botId: BOT, name: 'Guide', aiProviderRef: 'p' }),
            aiService: { generateBotResponseStream: answering },
            conversationMemory: memory,
            conversationStorage: storage,
        });
        const person = { matrixUserId: ALICE, uuid: 'uuid-alice', name: 'Alice', isGuest: false };
        const history = () => memory.getMemory(BOT, service.playerIdFor(ALICE))!.conversationHistory.map((entry) => entry.message);

        // The answer is made but sending it fails: nothing of it is remembered.
        const lost = await (service as any).replyNow(BOT, person, 'hi', [], {});
        expect(lost.text).toBe('Hello Alice!');
        expect(history()).toEqual(['hi']);

        // The retry is answered from the person's message alone, and once sent the answer is kept.
        const sent = await (service as any).replyNow(BOT, person, 'hi', [], {});
        expect(history()).toEqual(['hi']);
        sent.keep();
        sent.keep();
        expect(history()).toEqual(['hi', 'Hello Alice!']);
        expect(storage.addMessage).not.toHaveBeenCalled();
    });
});

describe('Bot status notes', () => {
    it('guesses the language from the script or common words, English when unsure', () => {
        expect(detectLanguage('مرحبا')).toBe('ar');
        expect(detectLanguage('こんにちは、元気？')).toBe('ja');
        expect(detectLanguage('안녕하세요')).toBe('ko');
        expect(detectLanguage('你好，你在吗')).toBe('zh');
        expect(detectLanguage('Bonjour, tu es là ?')).toBe('fr');
        expect(detectLanguage('Hola, ¿estás ahí?')).toBe('es');
        expect(detectLanguage('Hallo, bist du da?')).toBe('de');
        expect(detectLanguage('Olá, você está aí?')).toBe('pt');
        expect(detectLanguage('Ciao, come stai?')).toBe('it');
        expect(detectLanguage('Hoi, ben je er?')).toBe('nl');
        expect(detectLanguage('Bon dia, com estàs?')).toBe('ca');
        expect(detectLanguage('Hello?')).toBe('en');
        expect(detectLanguage('ok')).toBe('en');
        expect(detectLanguage('')).toBe('en');
    });

    it('builds a notice other apps can read and the game can draw as a card', () => {
        const note = statusNoteContent('unready', 'en', 'Gate Keeper');
        expect(note).toEqual({
            msgtype: 'm.notice',
            body: "Gate Keeper isn't ready to chat yet. The bot's owner still needs to finish setting it up. Try again another day.",
            [BOT_STATUS_KEY]: {
                state: 'unready',
                title: 'Not ready yet',
                text: "The bot's owner still needs to finish setting it up. Try again another day.",
                lang: 'en',
            },
        });
    });

    it('reads a bot state from its configuration', () => {
        expect(availabilityOf(null)).toBe('gone');
        expect(availabilityOf({ enabled: false, aiProviderRef: 'p' } as never)).toBe('resting');
        expect(availabilityOf({ enabled: true } as never)).toBe('unready');
        expect(availabilityOf({ aiProviderRef: 'p' } as never)).toBe('online');
    });
});

describe('DmReplyService resting line', () => {
    it('asks the bot for one short in-character line, and gives up quietly', async () => {
        const { DmReplyService } = await import('../server/DmReplyService');
        const service = Object.create(DmReplyService.prototype) as InstanceType<typeof DmReplyService>;
        const quickGenerate = vi.fn(async () => 'Not now, sailor!');
        Object.assign(service, { aiService: { quickGenerate } });
        const config = { botId: BOT, name: 'Mira', aiProviderRef: 'p', chatInstructions: 'You are a pirate.' } as never;
        expect(await service.restingLine(config, 'Are you around?')).toBe('Not now, sailor!');
        // With the bot id, so a bot on Universe AI or a lent key reaches its key
        expect(quickGenerate).toHaveBeenCalledWith('p', expect.stringContaining('You are a pirate.'), 'Are you around?', BOT);
        quickGenerate.mockRejectedValueOnce(new Error('provider down'));
        expect(await service.restingLine(config, 'hi')).toBe('');
        expect(await service.restingLine({ botId: BOT } as never, 'hi')).toBe('');
    });
});

describe('DmReplyService bot settings', () => {
    it('gives Orbit a time limit, so a stalled Orbit cannot hold a chat back', async () => {
        const { DmReplyService } = await import('../server/DmReplyService');
        const service = Object.create(DmReplyService.prototype) as InstanceType<typeof DmReplyService>;
        const getBotConfiguration = vi.fn(async () => ({ botId: BOT, name: 'Guide' }));
        const admin = { isConfigured: () => true, getBotConfiguration };
        Object.assign(service, {
            botManager: { getBot: () => undefined, getAdminApiService: () => admin },
            configCache: new Map(),
            missingCache: new Map(),
        });
        await service.getBotConfig(BOT);
        expect(getBotConfiguration).toHaveBeenCalledWith(BOT, 10_000);
    });

    it('keeps real bots cached when many ids that are not bots are looked up', async () => {
        const { DmReplyService } = await import('../server/DmReplyService');
        const service = Object.create(DmReplyService.prototype) as InstanceType<typeof DmReplyService>;
        const getBotConfiguration = vi.fn(async (botId: string) => (botId === BOT ? ({ botId: BOT, name: 'Guide' } as never) : null));
        Object.assign(service, {
            configCache: new Map(),
            missingCache: new Map(),
            botManager: { getBot: () => undefined, getAdminApiService: () => ({ isConfigured: () => true, getBotConfiguration }) },
        });
        expect(await service.getBotConfig(BOT)).toMatchObject({ botId: BOT });
        for (let i = 0; i < 1500; i++) expect(await service.getBotConfig(`not-a-bot-${i}`)).toBeNull();
        getBotConfiguration.mockClear();
        expect(await service.getBotConfig(BOT)).toMatchObject({ botId: BOT });
        // A recent "not a bot" answer is kept too, so asking again does not reach Orbit
        expect(await service.getBotConfig('not-a-bot-1499')).toBeNull();
        expect(getBotConfiguration).not.toHaveBeenCalled();
        expect((service as any).missingCache.size).toBe(1000);
    });
});

describe('MatrixDmBridge waiting messages', () => {
    it('forgets messages kept in this process after a day, even if the bot stays off', async () => {
        const client = makeClient();
        const deps = makeDeps();
        const bridge = new MatrixDmBridge(config, client as never, deps);
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue({ botId: BOT, name: 'Guide', enabled: false, aiProviderRef: 'p' } as never);
        await bridge.onEvent(message('anyone?'));
        expect((bridge as any).localWaiting.size).toBe(1);
        const rooms: Map<string, { at: number }> = (bridge as any).localWaiting.get(BOT);
        rooms.get(ROOM)!.at -= 24 * 60 * 60 * 1000;
        await bridge.checkWaiting();
        expect((bridge as any).localWaiting.size).toBe(0);
    });
});
