/**
 * Starting and ending a call with a bot (game #2004): the call's client is its own, never one of the bots standing in
 * a room; there is one live call per person and bot; and the bot hangs up when the caller does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotManager, CALL_JOIN_DEADLINE_MS } from '../server/BotManager';
import { BotCannotCallError, BotUnavailableError } from '../utils/summonErrors';
import { isCallSpaceName, parseCallSpaceName } from '../../libs/shared-utils/src/Space/callSpaceName';

function fakeClient(options: { accept?: boolean } = {}) {
    return {
        onDisconnect: undefined as (() => void) | undefined,
        onCallOver: undefined as ((space: string) => void) | undefined,
        onCallJoined: undefined as ((space: string) => void) | undefined,
        connect: vi.fn().mockResolvedValue(undefined),
        acceptCall: vi.fn().mockResolvedValue(options.accept ?? true),
        endCall: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
    };
}

function setup(config: Record<string, unknown> | null = { botId: 'b1', name: 'Nora', voiceEnabled: true }) {
    const admin = { isConfigured: () => false, getBotConfiguration: vi.fn().mockResolvedValue(config) };
    const manager = new BotManager(admin as never, {} as never);
    const clients: ReturnType<typeof fakeClient>[] = [];
    const build = vi.spyOn(manager as never as { buildClient: () => unknown }, 'buildClient').mockImplementation((async () => {
        const client = fakeClient();
        clients.push(client);
        return client;
    }) as never);
    return { manager, admin, build, clients };
}

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('BotManager calls', () => {
    it('opens a call-only connection and joins a private space made for this caller and bot', async () => {
        const { manager, build, clients } = setup();
        const { spaceName } = await manager.startCall('b1', 'uuid-1');
        expect(build).toHaveBeenCalledWith('b1', expect.objectContaining({ voiceEnabled: true }), { callOnly: true });
        expect(isCallSpaceName(spaceName)).toBe(true);
        expect(parseCallSpaceName(spaceName)).toMatchObject({ botId: 'b1', callerUuid: 'uuid-1' });
        expect(clients[0].acceptCall).toHaveBeenCalledWith(spaceName);
        expect(manager.liveCalls()).toBe(1);
    });

    it('is not one of the bots standing in a room', async () => {
        const { manager } = setup();
        await manager.startCall('b1', 'uuid-1');
        expect(manager.getBot('b1')).toBeNull();
        expect(manager.getAllBots()).toEqual([]);
    });

    it('says a bot can take a call only when it is there and has a voice', async () => {
        expect(await setup().manager.canTakeCall('b1')).toBe(true);
        expect(await setup({ botId: 'b1', name: 'Nora', voiceEnabled: false }).manager.canTakeCall('b1')).toBe(false);
        expect(await setup({ botId: 'b1', name: 'Nora', voiceEnabled: true, enabled: false }).manager.canTakeCall('b1')).toBe(false);
        expect(await setup(null).manager.canTakeCall('b1')).toBe(false);
        const broken = setup();
        broken.admin.getBotConfiguration.mockRejectedValue(new Error('down'));
        expect(await broken.manager.canTakeCall('b1')).toBe(false);
    });

    it('keeps one live call per person and bot: a new one replaces the old', async () => {
        const { manager, clients } = setup();
        const first = await manager.startCall('b1', 'uuid-1');
        const second = await manager.startCall('b1', 'uuid-1');
        expect(second.spaceName).not.toBe(first.spaceName);
        expect(clients[0].endCall).toHaveBeenCalledWith(first.spaceName);
        expect(manager.liveCalls()).toBe(1);
        await manager.startCall('b1', 'uuid-2');
        expect(manager.liveCalls()).toBe(2);
    });

    it('refuses a bot that is not there, and a bot with no voice', async () => {
        await expect(setup(null).manager.startCall('b1', 'uuid-1')).rejects.toBeInstanceOf(BotUnavailableError);
        await expect(setup({ botId: 'b1', name: 'Nora', enabled: false }).manager.startCall('b1', 'uuid-1')).rejects.toBeInstanceOf(BotUnavailableError);
        const quiet = setup({ botId: 'b1', name: 'Nora', voiceEnabled: false });
        await expect(quiet.manager.startCall('b1', 'uuid-1')).rejects.toBeInstanceOf(BotCannotCallError);
        expect(quiet.build).not.toHaveBeenCalled();
    });

    it('hangs up and forgets the call when the bot cannot take it', async () => {
        const { manager, build, clients } = setup();
        build.mockImplementationOnce((async () => {
            const client = fakeClient({ accept: false });
            clients.push(client);
            return client;
        }) as never);
        await expect(manager.startCall('b1', 'uuid-1')).rejects.toBeInstanceOf(BotUnavailableError);
        expect(clients[0].disconnect).toHaveBeenCalled();
        expect(manager.liveCalls()).toBe(0);
    });

    it('hangs up when the caller leaves the space, and forgets the call when the connection is lost', async () => {
        const { manager, clients } = setup();
        const { spaceName } = await manager.startCall('b1', 'uuid-1');
        clients[0].onCallOver?.(spaceName);
        expect(clients[0].disconnect).toHaveBeenCalled();
        expect(manager.liveCalls()).toBe(0);

        await manager.startCall('b1', 'uuid-2');
        clients[1].onDisconnect?.();
        expect(manager.liveCalls()).toBe(0);
    });

    it('ends a call on request, once, and only for that person', async () => {
        const { manager, clients } = setup();
        const { spaceName } = await manager.startCall('b1', 'uuid-1');
        expect(await manager.endCall('b1', 'uuid-2')).toBe(false);
        expect(await manager.endCall('b1', 'uuid-1')).toBe(true);
        expect(clients[0].endCall).toHaveBeenCalledWith(spaceName);
        expect(await manager.endCall('b1', 'uuid-1')).toBe(false);
        expect(manager.liveCalls()).toBe(0);
    });

    it('does not keep a call a newer start has replaced while it was still connecting', async () => {
        const { manager, build, clients } = setup();
        let release!: () => void;
        build.mockImplementationOnce((async () => {
            const client = fakeClient();
            client.connect.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
            clients.push(client);
            return client;
        }) as never);
        const slow = manager.startCall('b1', 'uuid-1');
        await vi.waitFor(() => expect(clients).toHaveLength(1));
        const fast = await manager.startCall('b1', 'uuid-1');
        release();
        await expect(slow).rejects.toBeInstanceOf(BotUnavailableError);
        expect(clients[0].acceptCall).not.toHaveBeenCalled();
        expect(manager.liveCalls()).toBe(1);
        expect(isCallSpaceName(fast.spaceName)).toBe(true);
    });

    describe('a call nobody joins', () => {
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());

        it('is hung up when the caller never comes into the space', async () => {
            const { manager, clients } = setup();
            await manager.startCall('b1', 'uuid-1');
            vi.advanceTimersByTime(CALL_JOIN_DEADLINE_MS - 1);
            expect(clients[0].disconnect).not.toHaveBeenCalled();
            expect(manager.liveCalls()).toBe(1);
            vi.advanceTimersByTime(1);
            expect(clients[0].disconnect).toHaveBeenCalled();
            expect(manager.liveCalls()).toBe(0);
        });

        it('stays when the caller joins before the deadline', async () => {
            const { manager, clients } = setup();
            const { spaceName } = await manager.startCall('b1', 'uuid-1');
            clients[0].onCallJoined?.(spaceName);
            vi.advanceTimersByTime(CALL_JOIN_DEADLINE_MS * 3);
            expect(clients[0].disconnect).not.toHaveBeenCalled();
            expect(manager.liveCalls()).toBe(1);
        });

        it('sets no deadline when the caller was already in the space when the bot came in', async () => {
            const { manager, build, clients } = setup();
            build.mockImplementationOnce((async () => {
                const client = fakeClient();
                client.acceptCall.mockImplementation((space: string) => {
                    client.onCallJoined?.(space);
                    return Promise.resolve(true);
                });
                clients.push(client);
                return client;
            }) as never);
            await manager.startCall('b1', 'uuid-1');
            expect(vi.getTimerCount()).toBe(0);
            vi.advanceTimersByTime(CALL_JOIN_DEADLINE_MS * 2);
            expect(manager.liveCalls()).toBe(1);
        });

        it('leaves no timer behind when the call ends any way', async () => {
            const { manager, clients } = setup();
            await manager.startCall('b1', 'uuid-1');
            expect(vi.getTimerCount()).toBe(1);
            await manager.endCall('b1', 'uuid-1');
            expect(vi.getTimerCount()).toBe(0);

            const { spaceName } = await manager.startCall('b1', 'uuid-2');
            clients[1].onCallOver?.(spaceName);
            expect(vi.getTimerCount()).toBe(0);

            await manager.startCall('b1', 'uuid-3');
            clients[2].onDisconnect?.();
            expect(vi.getTimerCount()).toBe(0);

            await manager.startCall('b1', 'uuid-4');
            await manager.startCall('b1', 'uuid-4');
            expect(vi.getTimerCount()).toBe(1);
            (manager as never as { botRegistry: unknown }).botRegistry = { disconnect: vi.fn().mockResolvedValue(undefined) };
            await manager.shutdown();
            expect(vi.getTimerCount()).toBe(0);
        });
    });

    it('keeps exactly one live call when two starts for the same person and bot run together', async () => {
        const { manager, clients } = setup();
        const results = await Promise.allSettled([manager.startCall('b1', 'uuid-1'), manager.startCall('b1', 'uuid-1')]);
        expect(manager.liveCalls()).toBe(1);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        // Whatever was built for the start that lost is not left connected
        const kept = clients.filter((c) => c.disconnect.mock.calls.length === 0 && c.endCall.mock.calls.length === 0);
        expect(kept.length).toBeLessThanOrEqual(1);
    });

    it('does not connect a call the caller hung up on while its settings were still being fetched', async () => {
        const { manager, admin, clients } = setup();
        let answer!: (value: unknown) => void;
        admin.getBotConfiguration.mockImplementation(
            () =>
                new Promise((resolve) => {
                    answer = resolve;
                })
        );
        const starting = manager.startCall('b1', 'uuid-1');
        const rejected = expect(starting).rejects.toBeInstanceOf(BotUnavailableError);
        await vi.waitFor(() => expect(admin.getBotConfiguration).toHaveBeenCalled());
        // The hang-up arrives while the settings are still on their way
        expect(await manager.endCall('b1', 'uuid-1')).toBe(true);
        answer({ botId: 'b1', name: 'Nora', voiceEnabled: true });
        await rejected;
        expect(clients).toHaveLength(0);
        expect(manager.liveCalls()).toBe(0);
    });

    it('does not connect a call the caller hung up on while its client was being built', async () => {
        const { manager, build, clients } = setup();
        let built!: () => void;
        build.mockImplementationOnce(
            (() =>
                new Promise((resolve) => {
                    built = () => {
                        const client = fakeClient();
                        clients.push(client);
                        resolve(client);
                    };
                })) as never
        );
        const starting = manager.startCall('b1', 'uuid-1');
        const rejected = expect(starting).rejects.toBeInstanceOf(BotUnavailableError);
        await vi.waitFor(() => expect(build).toHaveBeenCalled());
        await manager.endCall('b1', 'uuid-1');
        built();
        await rejected;
        expect(clients[0].connect).not.toHaveBeenCalled();
        expect(manager.liveCalls()).toBe(0);
    });

    it('cancels a start still being set up when the server shuts down', async () => {
        const { manager, admin } = setup();
        let answer!: (value: unknown) => void;
        admin.getBotConfiguration.mockImplementation(
            () =>
                new Promise((resolve) => {
                    answer = resolve;
                })
        );
        const starting = manager.startCall('b1', 'uuid-1');
        const rejected = expect(starting).rejects.toBeInstanceOf(BotUnavailableError);
        await vi.waitFor(() => expect(admin.getBotConfiguration).toHaveBeenCalled());
        (manager as never as { botRegistry: unknown }).botRegistry = { disconnect: vi.fn().mockResolvedValue(undefined) };
        await manager.shutdown();
        answer({ botId: 'b1', name: 'Nora', voiceEnabled: true });
        await rejected;
        expect(manager.liveCalls()).toBe(0);
    });

    it('does not say a call is on when it was ended while the bot was taking it', async () => {
        const { manager, build, clients } = setup();
        let accepted!: (value: boolean) => void;
        build.mockImplementationOnce((async () => {
            const client = fakeClient();
            client.acceptCall.mockImplementation(
                () =>
                    new Promise<boolean>((resolve) => {
                        accepted = resolve;
                    })
            );
            clients.push(client);
            return client;
        }) as never);
        const starting = manager.startCall('b1', 'uuid-1');
        const rejected = expect(starting).rejects.toBeInstanceOf(BotUnavailableError);
        await vi.waitFor(() => expect(clients[0]?.acceptCall).toHaveBeenCalled());
        await manager.endCall('b1', 'uuid-1');
        accepted(true);
        await rejected;
        expect(manager.liveCalls()).toBe(0);
        expect(clients[0].disconnect).toHaveBeenCalled();
    });
});
