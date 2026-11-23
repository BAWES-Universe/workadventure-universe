import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createMatrixAppServiceRouter, type EventHooks, type MatrixEvent } from '../matrix/MatrixAppServiceRouter';
import { createEventInbox, type ClosedEvent, type EventInbox, type InboxEntry, type Recovered } from '../matrix/MatrixEventInbox';

const config = { homeserverUrl: 'http://hs', domain: 'matrix.test', asToken: 'as-secret', hsToken: 'hs-secret' };
const event = (id: string): MatrixEvent => ({ type: 'm.room.message', room_id: '!room:matrix.test', sender: '@alice:matrix.test', event_id: id, content: { msgtype: 'm.text', body: 'hi' } });

/** An inbox that has nothing to hand out and has closed these events while it looked. */
const closing = (closed: ClosedEvent[]): EventInbox => ({
    owner: 'one',
    take: async () => false,
    recover: async () => {
        const list: unknown[] = [];
        Object.defineProperty(list, 'closed', { value: closed, enumerable: false });
        return list as Recovered;
    },
});

// CodeRabbit on 27ab3385: a closure the recovery scan reports starts work (the note to the person); shutdown waits for it
describe('the notice of an event given up on, found by the recovery scan, is part of the shutdown drain', () => {
    const setup = (notice: () => Promise<void>) => {
        const onGaveUp = vi.fn(notice);
        const router = createMatrixAppServiceRouter(config, { onEvent: async () => undefined, userExists: async () => true, onGaveUp }, { inbox: closing([{ why: 'tries', eventId: '$a', event: event('$a') }]) });
        return { router, onGaveUp };
    };

    it('settle waits for a notice that is still being sent', async () => {
        let finish: () => void = () => undefined;
        const { router, onGaveUp } = setup(() => new Promise<void>((resolve) => (finish = resolve)));
        await router.recover();
        expect(onGaveUp).toHaveBeenCalledTimes(1);
        let settled: boolean | undefined;
        const waiting = router.settle(5000).then((value) => (settled = value));
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(settled).toBeUndefined();
        finish();
        await waiting;
        expect(settled).toBe(true);
    });

    it('a notice that never finishes cannot hold shutdown: settle gives up at its timeout and says the work was not finished', async () => {
        const { router } = setup(() => new Promise<void>(() => undefined));
        await router.recover();
        expect(await router.settle(100)).toBe(false);
    });

    it('a notice that fails is no reason to hold shutdown, and with nothing to report settle is at once true', async () => {
        const failing = setup(async () => {
            throw new Error('chat store down');
        });
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await failing.router.recover();
        expect(await failing.router.settle(1000)).toBe(true);
        const idle = createMatrixAppServiceRouter(config, { onEvent: async () => undefined, userExists: async () => true }, { inbox: closing([]) });
        await idle.recover();
        expect(await idle.settle(1000)).toBe(true);
    });
});

// CodeRabbit on 27ab3385: the bridge may hold a failed lookup only for an event the inbox holds; the router says which case it is
describe('the router tells the handler whether the event has a durable inbox entry', () => {
    const deliver = async (inbox: EventInbox | undefined) => {
        const seen: Array<EventHooks | undefined> = [];
        const router = createMatrixAppServiceRouter(config, { onEvent: async (_event, hooks) => void seen.push(hooks), userExists: async () => true }, inbox ? { inbox } : {});
        const app = express();
        app.use(router);
        const server = await new Promise<import('node:http').Server>((resolve) => {
            const one = app.listen(0, () => resolve(one));
        });
        try {
            const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
            const res = await fetch(`${base}/_matrix/app/v1/transactions/t1`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer hs-secret' }, body: JSON.stringify({ events: [event('$one')] }) });
            expect(res.status).toBe(200);
            await router.settle(2000);
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
        return seen;
    };

    it('an entry the store holds: durable', async () => {
        const entry: InboxEntry = { paid: async () => undefined, done: async () => undefined, release: async () => 'again', undo: async () => undefined } as never;
        const seen = await deliver({ owner: 'one', take: async () => entry, recover: async () => [] as unknown as Recovered });
        expect(seen).toHaveLength(1);
        expect(seen[0]?.durable).toBe(true);
    });

    it('the store not connected (nothing is kept): not durable, so the bridge never holds the room for it', async () => {
        const seen = await deliver(createEventInbox(() => null));
        expect(seen).toHaveLength(1);
        expect(seen[0]?.durable).toBe(false);
    });

    it('no inbox at all: not durable', async () => {
        const seen = await deliver(undefined);
        expect(seen).toHaveLength(1);
        expect(seen[0]?.durable).toBe(false);
    });
});

// CodeRabbit on a767269a: a give-back the store did not answer goes on after the room chain has ended, and may turn out to be the last try; shutdown waits for it
describe('a give-back that is still being retried is part of the shutdown drain', () => {
    const withRetry = () => {
        let finish: (closed: boolean) => void = () => undefined;
        let retrying: Promise<void> | undefined;
        const onGaveUp = vi.fn(async () => undefined);
        const entry = {
            paid: async () => undefined,
            done: async () => undefined,
            undo: async () => undefined,
            // the store did not answer: the retries go on after this
            release: async (onClosed?: () => void) => {
                retrying = new Promise<void>((resolve) => {
                    finish = (closed) => {
                        if (closed) onClosed?.();
                        resolve();
                    };
                });
                return 'unsure' as const;
            },
            givingBack: () => retrying,
        } as unknown as InboxEntry;
        const inbox: EventInbox = {
            owner: 'one',
            take: async () => false,
            recover: async () => {
                const list = [{ event: event('$a'), entry }];
                Object.defineProperty(list, 'closed', { value: [], enumerable: false });
                return list as unknown as Recovered;
            },
        };
        const router = createMatrixAppServiceRouter(
            config,
            {
                onEvent: async () => {
                    throw new Error('lookup failed');
                },
                userExists: async () => true,
                onGaveUp,
            },
            { inbox }
        );
        return { router, onGaveUp, finish: (closed: boolean) => finish(closed) };
    };

    it('settle waits until the retry has ended, and the failure notice it ends with is made before settle answers', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { router, onGaveUp, finish } = withRetry();
        await router.recover();
        let settled: boolean | undefined;
        const waiting = router.settle(5000).then((value) => (settled = value));
        await new Promise((resolve) => setTimeout(resolve, 80));
        // the chain is over, the give-back is not
        expect(settled).toBeUndefined();
        finish(true);
        await waiting;
        expect(settled).toBe(true);
        expect(onGaveUp).toHaveBeenCalledTimes(1);
        expect(onGaveUp).toHaveBeenCalledWith(expect.objectContaining({ event_id: '$a' }), 'tries');
    });

    it('a retry that never ends cannot hold shutdown beyond its timeout', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { router } = withRetry();
        await router.recover();
        expect(await router.settle(100)).toBe(false);
    });
});
