/**
 * A bot's call-only connection (game #2004): no room, no body on the map. It is ready as soon as its socket opens, its
 * voice starts then, and it hangs up when the caller leaves the call's space. Nothing in a call is greeted in writing,
 * and what the person says is not asked of Orbit's chat rule again (the call was allowed when it started).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callSpaceName } from '../../libs/shared-utils/src/Space/callSpaceName';

const { sockets, FakeSocket } = vi.hoisted(() => {
    const sockets: unknown[] = [];
    class FakeSocket {
        static OPEN = 1;
        readyState = 1;
        binaryType = '';
        private handlers = new Map<string, (...args: unknown[]) => void>();
        constructor(
            readonly url: string,
            readonly protocols: string[]
        ) {
            sockets.push(this);
        }
        on(event: string, handler: (...args: unknown[]) => void): this {
            this.handlers.set(event, handler);
            return this;
        }
        emit(event: string, ...args: unknown[]): void {
            this.handlers.get(event)?.(...args);
        }
        send = vi.fn();
        close = vi.fn();
        pong = vi.fn();
    }
    return { sockets, FakeSocket };
});
vi.mock('ws', () => ({ default: FakeSocket, WebSocket: FakeSocket }));

import { BotClient } from '../client/BotClient';

const SPACE = callSpaceName({ botId: 'b1', callerUuid: 'uuid-1', callId: 'c1' });

function bot(callOnly: boolean) {
    const client = new BotClient({
        botId: 'b1',
        name: 'Nora',
        roomUrl: 'http://play.example.test/_/global/maps.example.test/lobby.tmj',
        pusherUrl: 'http://play.example.test',
        position: { x: 100, y: 100 },
        viewport: { top: 0, bottom: 600, left: 0, right: 800 },
        characterTextureIds: [],
        callOnly,
    });
    const internals = client as unknown as {
        joined: boolean;
        startVoice: () => void;
        handleSubMessage(m: unknown): Promise<void>;
        mayChat(space: string, sender: number, message: object): Promise<boolean>;
        emitJoinSpace: (...args: unknown[]) => Promise<string>;
        emitAddSpaceFilter: (...args: unknown[]) => void;
        sendSpaceUserUpdate: (...args: unknown[]) => void;
        spaces: Map<string, string>;
    };
    return { client, internals };
}

beforeEach(() => {
    sockets.length = 0;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('BotClient call-only connection', () => {
    it('asks for a call-only connection, and is ready with its voice once the socket opens', async () => {
        const { client, internals } = bot(true);
        const startVoice = vi.fn();
        internals.startVoice = startVoice;
        const connecting = client.connect();
        (sockets[0] as InstanceType<typeof FakeSocket>).emit('open');
        await connecting;
        expect(new URL((sockets[0] as InstanceType<typeof FakeSocket>).url).searchParams.get('callOnly')).toBe('true');
        expect(internals.joined).toBe(true);
        expect(startVoice).toHaveBeenCalledTimes(1);
    });

    it('an ordinary bot does not ask for it and waits for the room to confirm the join', async () => {
        const { client, internals } = bot(false);
        const startVoice = vi.fn();
        internals.startVoice = startVoice;
        const connecting = client.connect();
        (sockets[0] as InstanceType<typeof FakeSocket>).emit('open');
        await connecting;
        expect(new URL((sockets[0] as InstanceType<typeof FakeSocket>).url).searchParams.has('callOnly')).toBe(false);
        expect(internals.joined).toBe(false);
        expect(startVoice).not.toHaveBeenCalled();
    });

    it('is not greeted in writing in a call, and a call is not asked about again as chat', async () => {
        const { client, internals } = bot(true);
        const gate = { check: vi.fn().mockResolvedValue({ allowed: false, kind: 'refused', code: 'not_allowed', line: 'No' }) };
        client.setAccessGate(gate as never);
        client.setBehavior({ setBot: vi.fn(), getConfiguredFacing: vi.fn() } as never);
        expect(await client.mayGreet(SPACE, 7)).toBe(false);
        expect(await internals.mayChat(SPACE, 7, {})).toBe(true);
        expect(gate.check).not.toHaveBeenCalled();
    });

    it('takes a call by joining its space with nothing to show', async () => {
        const { client, internals } = bot(true);
        const onSpaceJoined = vi.fn();
        client.setBehavior({ setBot: vi.fn(), onSpaceJoined, getConfiguredFacing: vi.fn() } as never);
        internals.emitJoinSpace = vi.fn().mockResolvedValue('call_abc');
        internals.emitAddSpaceFilter = vi.fn();
        const update = vi.fn();
        internals.sendSpaceUserUpdate = update;
        expect(await client.acceptCall(SPACE)).toBe(true);
        expect(internals.spaces.get(SPACE)).toBe('call_abc');
        expect(update).toHaveBeenCalledWith(SPACE, { cameraState: false, microphoneState: false, screenSharingState: false });
        expect(onSpaceJoined).toHaveBeenCalledWith(SPACE);
    });

    it('takes no call that is not one, and an ordinary bot takes none at all', async () => {
        const { client, internals } = bot(true);
        internals.emitJoinSpace = vi.fn().mockResolvedValue('x');
        expect(await client.acceptCall('some-bubble')).toBe(false);
        expect(await bot(false).client.acceptCall(SPACE)).toBe(false);
        expect(internals.emitJoinSpace).not.toHaveBeenCalled();
    });

    it('hangs up when the caller leaves the space, and not when something else does', async () => {
        const { client, internals } = bot(true);
        client.setBehavior({ setBot: vi.fn(), onSpaceUserLeft: vi.fn(), getConfiguredFacing: vi.fn() } as never);
        internals.spaces.set(SPACE, 'call_abc');
        const over = vi.fn();
        client.onCallOver = over;
        await internals.handleSubMessage({ $case: 'removeSpaceUserMessage', removeSpaceUserMessage: { spaceName: SPACE, spaceUserId: 'call_abc' } });
        expect(over).not.toHaveBeenCalled();
        await internals.handleSubMessage({ $case: 'removeSpaceUserMessage', removeSpaceUserMessage: { spaceName: 'a-bubble', spaceUserId: 'room_7' } });
        expect(over).not.toHaveBeenCalled();
        await internals.handleSubMessage({ $case: 'removeSpaceUserMessage', removeSpaceUserMessage: { spaceName: SPACE, spaceUserId: 'room_7' } });
        expect(over).toHaveBeenCalledWith(SPACE);
    });

    it('never takes the random id of a call-only connection for a player number', async () => {
        const { client, internals } = bot(true);
        const onSpaceUserLeft = vi.fn();
        client.setBehavior({ setBot: vi.fn(), onSpaceUserLeft, getConfiguredFacing: vi.fn() } as never);
        // A uuid starting with digits would parse as a number if the prefix were not recognised
        await internals.handleSubMessage({ $case: 'removeSpaceUserMessage', removeSpaceUserMessage: { spaceName: SPACE, spaceUserId: 'call_12345678-aaaa' } });
        expect(onSpaceUserLeft).toHaveBeenCalledWith(SPACE, 0);
    });
});
