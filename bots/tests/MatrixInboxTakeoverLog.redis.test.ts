import { randomUUID } from 'crypto';
import { createClient } from 'redis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { MatrixEvent } from '../matrix/MatrixAppServiceRouter';
import { createEventInbox, INBOX_KEY, type InboxEntry } from '../matrix/MatrixEventInbox';
import { takeTurnOnInbox } from './helpers/sharedInboxLock';

/**
 * GPT's seventh note (item 0, after release): when the take-over closes an inbox entry whose server went away AFTER paid work began, the entry fails closed (never run again, so
 * no second charge) and the person is told. That loss is also LOGGED by the inbox itself, with the event and room, so an operator can see it without reading Sentry.
 */
const URL = process.env.BOTS_TEST_REDIS_URL;
describe.runIf(!!URL)('the take-over logs an entry it closes as paid work (a real Redis)', () => {
    const client = createClient({ url: URL });
    const used: string[] = [];
    let giveTurnBack: (() => Promise<void>) | undefined;
    beforeAll(async () => {
        await client.connect();
        giveTurnBack = await takeTurnOnInbox(client as never);
    }, 330_000);
    afterEach(async () => {
        if (used.length > 0)
            await client.del([
                ...used.map((id) => `matrix:event:${id}`),
                ...used.map((id) => `matrix:inbox:${id}`),
                ...used.map((id) => `matrix:inbox-open:${id}`),
                ...used.map((id) => `matrix:inbox-answer:${id}`),
                ...used.map((id) => `matrix:inbox-admitted:${id}`),
                ...used.map((id) => `matrix:inbox-resend:${id}`),
                ...used.map((id) => `matrix:inbox-waited:${id}`),
                ...used.map((id) => `matrix:room-order:!room-${id}:matrix.test`),
            ]);
        for (const id of used) await client.zRem(INBOX_KEY, id);
        used.length = 0;
    });
    afterAll(async () => {
        await giveTurnBack?.();
        await client.quit();
    });
    const fresh = (what: string) => {
        const id = `$${what}-${randomUUID()}`;
        used.push(id);
        return id;
    };
    const message = (id: string): MatrixEvent => ({ type: 'm.room.message', room_id: `!room-${id}:matrix.test`, sender: '@alice:matrix.test', event_id: id, content: { msgtype: 'm.text', body: 'Hi' } });
    const inboxOn = (extra: Parameters<typeof createEventInbox>[1] = {}) => createEventInbox(() => client as never, { ttlSeconds: 60, beatEveryMs: 60_000, ...extra });

    it('an entry whose owner went away after paid work began is closed as paid and the take-over says so, naming the event and its room', async () => {
        const id = fresh('paid-log');
        const dead = inboxOn({ staleMs: 60 });
        const entry = (await dead.take(id, message(id))) as InboxEntry;
        await entry.admit();
        await entry.paid();
        await new Promise((resolve) => setTimeout(resolve, 150));
        const said: string[] = [];
        const scanner = inboxOn({ staleMs: 60, log: (line, detail) => void said.push(`${line} ${String(detail ?? '')}`) });
        const found = await scanner.recover();
        expect(found).toHaveLength(0);
        expect(found.closed?.map((one) => [one.why, one.eventId])).toEqual([['paid', id]]);
        const line = said.find((one) => one.includes(id));
        expect(line).toBeDefined();
        expect(line).toContain('paid');
        expect(line).toContain(`!room-${id}:matrix.test`);
        expect(line).toMatch(/not run again|never run again/);
    });

    it('an entry that ran out of tries is closed too, and is NOT logged as paid work', async () => {
        const id = fresh('tries-log');
        const dead = inboxOn({ staleMs: 60, maxTries: 1 });
        await ((await dead.take(id, message(id))) as InboxEntry).admit();
        await new Promise((resolve) => setTimeout(resolve, 150));
        const said: string[] = [];
        const scanner = inboxOn({ staleMs: 60, maxTries: 1, log: (line, detail) => void said.push(`${line} ${String(detail ?? '')}`) });
        const found = await scanner.recover();
        expect(found.closed?.map((one) => [one.why, one.eventId])).toEqual([['tries', id]]);
        expect(said.filter((one) => one.includes('paid'))).toEqual([]);
    });
});
