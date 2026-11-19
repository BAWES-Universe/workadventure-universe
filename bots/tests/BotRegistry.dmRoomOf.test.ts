/** The direct chat of a bot and a person is forgotten only while the store still points at the room that was seen. */
import { describe, expect, it } from 'vitest';
import { BotRegistry } from '../server/BotRegistry';

function fakeRedis() {
    const hash = new Map<string, string>();
    return {
        isOpen: true,
        hash,
        hSet: async (_key: string, field: string, value: string) => void hash.set(field, value),
        hDel: async (_key: string, field: string) => (hash.delete(field) ? 1 : 0),
        // The script as Redis runs it: delete only when the stored room is the one given
        eval: async (_script: string, options: { keys: string[]; arguments: string[] }) => {
            const [field, room] = options.arguments;
            return hash.get(field) === room ? (hash.delete(field), 1) : 0;
        },
    };
}

const registryWith = (redis: unknown) => Object.assign(new BotRegistry('test'), { redis });

describe('forgetting the direct chat of a bot and a person', () => {
    it('keeps a newer chat that was noted after the old one was seen to be gone', async () => {
        const redis = fakeRedis();
        const registry = registryWith(redis);
        await registry.rememberDmRoomOf('b1', '@alice:x', '!new:x');
        await registry.forgetDmRoomOf('b1', '@alice:x', '!old:x');
        expect(redis.hash.get('b1|@alice:x')).toBe('!new:x');
    });

    it('forgets the chat that is still the one stored', async () => {
        const redis = fakeRedis();
        const registry = registryWith(redis);
        await registry.rememberDmRoomOf('b1', '@alice:x', '!old:x');
        await registry.forgetDmRoomOf('b1', '@alice:x', '!old:x');
        expect(redis.hash.has('b1|@alice:x')).toBe(false);
    });
});
