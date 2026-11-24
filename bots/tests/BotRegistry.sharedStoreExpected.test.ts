import { afterEach, describe, expect, it, vi } from 'vitest';

// The client is never connected here: a registry only has to say whether a shared store was named for it
vi.mock('redis', () => ({
    createClient: () => ({ on: vi.fn(), isOpen: false, connect: vi.fn(), quit: vi.fn() }),
}));
import { BotRegistry } from '../server/BotRegistry';

/**
 * Whether a shared store is EXPECTED to hold things for a server (CodeRabbit on the start keys): a server that has one named (a host in its config, or REDIS_HOST) and cannot reach it
 * has an outage; a server with none named is one machine on its own. The start of a computer job that finds no key of its ask and a silent store waits only in the first case.
 */
const host = process.env.REDIS_HOST;
afterEach(() => {
    if (host === undefined) delete process.env.REDIS_HOST;
    else process.env.REDIS_HOST = host;
});

describe('whether a shared store is expected for a bot server', () => {
    it('is expected when a host is given in the config, or in REDIS_HOST', () => {
        delete process.env.REDIS_HOST;
        expect(new BotRegistry('s1', { host: 'redis.internal' }).sharedStoreExpected()).toBe(true);
        process.env.REDIS_HOST = 'redis.internal';
        expect(new BotRegistry('s2').sharedStoreExpected()).toBe(true);
    });

    it('is not expected when none is named and none has been reached (one machine on its own)', () => {
        delete process.env.REDIS_HOST;
        expect(new BotRegistry('s3').sharedStoreExpected()).toBe(false);
    });

    it('is expected once the store has been reached, whatever named it', () => {
        delete process.env.REDIS_HOST;
        const registry = new BotRegistry('s4');
        (registry as unknown as { sharedStoreSeen: boolean }).sharedStoreSeen = true;
        expect(registry.sharedStoreExpected()).toBe(true);
    });
});
