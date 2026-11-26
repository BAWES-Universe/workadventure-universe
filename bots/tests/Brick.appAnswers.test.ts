/**
 * What a run reads of an App's answer (game #2002 follow-up): a mail answer carries each message's whole encoded body, so it used to be cut
 * at 12,000 characters, mid-JSON, with no word of it. Now what nobody reads is taken out, whole items are left out of a list that is still
 * too long (and it says "Showing 20 of 50"), and only what cannot be shortened is cut, with the notice a chat reply gives.
 */
import { describe, expect, it } from 'vitest';
import { cutWithNote, fitAppAnswer, RUN_ANSWER_MAX } from '../server/BrickAppAnswer';

const base64url = (text: string) => Buffer.from(text, 'utf8').toString('base64url');
/** Readable filler of an exact length, with spaces and full stops as a message has. */
const prose = (length: number, seed = 'A line of an ordinary message about the visa appointment.') => (seed + ' ').repeat(Math.ceil(length / (seed.length + 1))).slice(0, length);

/** A message as a Gmail App gives it: who, what, when and a snippet, the plain text, and the raw payload with each part's encoded body. */
function message(n: number, bodyChars = 40_000) {
    const html = `<html><body>${'<div><p>Hello <b>there</b>, this is a long newsletter paragraph.</p></div>'.repeat(Math.ceil(bodyChars / 70))}</body></html>`;
    return {
        messageId: `msg-${n}`,
        threadId: `thr-${n}`,
        sender: `Sender ${n} <sender${n}@example.com>`,
        subject: `Subject ${n}`,
        messageTimestamp: `2026-11-${String((n % 28) + 1).padStart(2, '0')}T09:00:00Z`,
        preview: { subject: `Subject ${n}`, body: `Snippet ${n}` },
        messageText: `Plain text ${n}. ${prose(300)}`,
        labelIds: ['INBOX', 'UNREAD'],
        payload: {
            mimeType: 'multipart/alternative',
            headers: [
                { name: 'From', value: `Sender ${n} <sender${n}@example.com>` },
                { name: 'Subject', value: `Subject ${n}` },
                { name: 'Date', value: 'Tue, 25 Nov 2026 09:00:00 +0000' },
                { name: 'Received', value: 'from mail.example.com by mx.google.com with ESMTPS id abc123 for <me@example.com>' },
                { name: 'DKIM-Signature', value: 'v=1; a=rsa-sha256; c=relaxed/relaxed; d=example.com; s=2026; h=from:subject; bh=abc; b=def' },
                { name: 'X-Mailer', value: 'Newsletter 4.2' },
            ],
            parts: [
                { partId: '0', mimeType: 'text/plain', body: { size: 300, data: base64url(prose(bodyChars)) } },
                { partId: '1', mimeType: 'text/html', body: { size: bodyChars, data: base64url(html) } },
            ],
        },
    };
}

/** What an App's answer is through the tool server: a text block holding the App's own JSON. */
const asBlocks = (answer: unknown) => [{ type: 'text', text: JSON.stringify(answer) }];

describe('an answer that fits and has nothing to take out', () => {
    it('is exactly as it came', () => {
        expect(fitAppAnswer([{ type: 'text', text: 'Found 3 issues' }])).toBe('[{"type":"text","text":"Found 3 issues"}]');
        expect(fitAppAnswer('plain words')).toBe('plain words');
        expect(fitAppAnswer(undefined)).toBe('null');
        const small = asBlocks({ data: { messages: [{ sender: 'a@b.test', subject: 'Hi' }] } });
        expect(fitAppAnswer(small)).toBe(JSON.stringify(small));
    });

    it('keeps prose, ids and short encoded values; only long base64 is an encoded body', () => {
        // Words with no punctuation are still words: a space every few characters is not base64
        const answer = { text: prose(5_000), plain: 'hello world '.repeat(200), id: 'AbCdEf_-123', token: base64url('short') };
        expect(fitAppAnswer(answer)).toBe(JSON.stringify(answer));
    });
});

describe('an encoded body is taken out, and what the Brick reads a mail by stays', () => {
    it('drops the base64 of every part and the routing headers, and keeps sender, subject, date, snippet and the plain text', () => {
        const one = message(1, 20_000);
        const text = fitAppAnswer(asBlocks({ data: { messages: [one] }, successful: true }));
        const read = JSON.parse(text)[0].text.data.messages[0];
        expect(text.length).toBeLessThan(3_000);
        expect(read.sender).toBe(one.sender);
        expect(read.subject).toBe('Subject 1');
        expect(read.messageTimestamp).toBe(one.messageTimestamp);
        expect(read.preview.body).toBe('Snippet 1');
        expect(read.messageText).toBe(one.messageText);
        for (const part of read.payload.parts) expect(part.body.data).toMatch(/^\[encoded content left out, [\d,]+ characters\]$/);
        expect(read.payload.headers.map((header: { name: string }) => header.name)).toEqual(['From', 'Subject', 'Date']);
    });

    it('reads a message that is itself the whole answer, as an object and as a text block, and drops a raw message', () => {
        const raw = base64url(prose(30_000));
        expect(JSON.parse(fitAppAnswer({ id: 'm1', snippet: 'Hello', raw })).raw).toMatch(/^\[encoded content left out/);
        expect(JSON.parse(fitAppAnswer(JSON.stringify({ id: 'm1', snippet: 'Hello', raw }))).snippet).toBe('Hello');
        const wrapped = JSON.parse(fitAppAnswer(asBlocks({ id: 'm1', snippet: 'Hello', raw })));
        expect(wrapped[0].text).toMatchObject({ id: 'm1', snippet: 'Hello' });
        expect(JSON.stringify(wrapped)).not.toContain(raw.slice(0, 200));
    });

    it('takes out a base64 file with a line badge, e.g. data: addresses, and decodes a file that names its encoding', () => {
        const pixel = `data:image/png;base64,${Buffer.from('x'.repeat(3_000)).toString('base64')}`;
        expect(JSON.parse(fitAppAnswer({ image: pixel })).image).toMatch(/encoded content left out/);
        const source = 'export const answer = 42;\n'.repeat(60);
        const file = JSON.parse(fitAppAnswer({ name: 'a.ts', encoding: 'base64', content: Buffer.from(source).toString('base64') }));
        expect(file).toEqual({ name: 'a.ts', encoding: 'utf-8', content: source });
    });

    it('never reads a file as a mail: a decoded source file keeps its tags, styles and scripts, however many it has', () => {
        const source = `<script lang="ts">\n  let n = 0;\n</script>\n<style>.a { color: red }</style>\n${'<div class="a"><span>{n}</span></div>\n'.repeat(20)}`;
        const file = { name: 'Counter.svelte', encoding: 'base64', content: Buffer.from(source).toString('base64') };
        expect(JSON.parse(fitAppAnswer(file))).toEqual({ ...file, encoding: 'utf-8', content: source });
        // Nor when the answer is too long and markup is being read as text
        const long = JSON.parse(fitAppAnswer({ files: [file, { ...file, name: 'B.svelte' }] }, 1_500)) as { files: { content: string }[] };
        expect(long.files[0].content).toBe(source);
    });

    it('takes the tags, styles and scripts out of a mail written in HTML, and leaves a short snippet of markup alone', () => {
        const html = `<!DOCTYPE html><html><head><style>.a{color:red}</style></head><body><div><p>Dear Sara,</p><p>Your appointment is on <b>Tuesday</b> &amp; it is free.</p></div>${'<p>Filler line.</p>'.repeat(30)}<script>track()</script></body></html>`;
        // Markup that fits is what the App was asked for and stays as it is; the text is read only when the answer would not fit
        expect(fitAppAnswer({ subject: 'Appointment', html })).toBe(JSON.stringify({ subject: 'Appointment', html }));
        const read = JSON.parse(fitAppAnswer({ subject: 'Appointment', html }, 700)) as { subject: string; html: string };
        expect(read.subject).toBe('Appointment');
        expect(read.html).toContain('Dear Sara,');
        expect(read.html).toContain('Your appointment is on Tuesday & it is free.');
        expect(read.html).not.toMatch(/<|color:red|track\(\)/);
        const snippet = { code: '<div class="a">hello</div>' };
        expect(fitAppAnswer(snippet)).toBe(JSON.stringify(snippet));
    });
});

describe('routing headers are only taken from the headers of a mail', () => {
    it('leaves a list of names and values that is data alone, even when a name looks like a header', () => {
        const stock = { data: [{ name: 'X-100', value: 'In stock' }, { name: 'Y-200', value: 'Unavailable' }] };
        expect(fitAppAnswer(stock)).toBe(JSON.stringify(stock));
        const asBlock = asBlocks(stock);
        expect(fitAppAnswer(asBlock)).toBe(JSON.stringify(asBlock));
        // Under `headers`, but not a mail's (no From, Subject, Date ...)
        // Mail headers, but not under `headers`
        const elsewhere = { data: [{ name: 'Subject', value: 'Hi' }, { name: 'X-Mailer', value: 'y' }] };
        expect(fitAppAnswer(elsewhere)).toBe(JSON.stringify(elsewhere));
        // An HTTP response shares From, Date and Content-Type with a mail: those alone do not make it one
        const response = { headers: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Date', value: 'Tue, 25 Nov 2026 09:00:00 GMT' }, { name: 'From', value: 'a@b.test' }, { name: 'X-Request-Id', value: 'abc' }] };
        expect(fitAppAnswer(response)).toBe(JSON.stringify(response));
        const http = { headers: [{ name: 'X-Request-Id', value: 'abc' }, { name: 'X-Trace', value: 'def' }] };
        expect(fitAppAnswer(http)).toBe(JSON.stringify(http));
    });

    it('takes them from a mail whose headers are under `headers`, in any case', () => {
        const headers = [{ name: 'Subject', value: 'Hi' }, { name: 'Received', value: 'from x' }, { name: 'X-Mailer', value: 'y' }];
        for (const key of ['headers', 'Headers']) {
            const read = JSON.parse(fitAppAnswer({ payload: { [key]: headers } })) as { payload: Record<string, { name: string }[]> };
            expect(read.payload[key].map((header) => header.name)).toEqual(['Subject']);
        }
    });
});

describe('an answer that is still too long loses whole items, and says how many', () => {
    it('keeps the first items entire and tells the Brick "Showing k of 50"', () => {
        // 50 messages, each about 2,000 characters once the encoded bodies are out: 100,000 characters, past the room
        const messages = Array.from({ length: 50 }, (_, n) => ({ ...message(n + 1, 3_000), messageText: prose(1_500, `Message ${n + 1} says hello.`) }));
        const text = fitAppAnswer(asBlocks({ data: { messages, nextPageToken: 'next-1' }, successful: true }));
        expect(text.length).toBeLessThanOrEqual(RUN_ANSWER_MAX);
        const data = JSON.parse(text)[0].text.data;
        const shown = data.messages.length;
        expect(shown).toBeGreaterThan(20);
        expect(shown).toBeLessThan(50);
        expect(data.messages_note).toMatch(new RegExp(`^Showing ${shown} of 50: the other ${50 - shown} were left out`));
        // Whole items, in order: each kept message is as it was (minus what was taken out), none cut in half
        data.messages.forEach((read: { messageId: string; messageText: string }, n: number) => {
            expect(read.messageId).toBe(`msg-${n + 1}`);
            expect(read.messageText).toBe(messages[n].messageText);
        });
        expect(data.nextPageToken).toBe('next-1');
    });

    it('fits the most items that fit, not fewer', () => {
        const items = Array.from({ length: 10 }, (_, n) => ({ id: n, text: prose(900, `Item ${n}.`) }));
        const max = 5_000;
        const text = fitAppAnswer({ items }, max);
        const shown = JSON.parse(text).items.length;
        expect(text.length).toBeLessThanOrEqual(max);
        // One more item would not have fit
        const more = JSON.stringify({ items: items.slice(0, shown + 1), items_note: `Showing ${shown + 1} of 10: the other ${10 - shown - 1} were left out because the whole answer was too long. Search again with narrower words or a smaller page to see them.` });
        expect(more.length).toBeGreaterThan(max);
    });

    it('shortens a list that is the whole answer, and a list inside a list', () => {
        const rows = Array.from({ length: 30 }, (_, n) => ({ id: n, text: prose(900, `Row ${n}.`) }));
        const top = JSON.parse(fitAppAnswer(rows, 10_000));
        expect(top.note).toMatch(/^Showing \d+ of 30:/);
        expect(top.items[0]).toEqual(rows[0]);
        const nested = JSON.parse(fitAppAnswer([[{ id: 1 }, { id: 2 }], rows], 10_000));
        expect(nested[1].note).toMatch(/^Showing \d+ of 30:/);
    });

    it('shortens the next list when the longest one alone is not enough, and always keeps at least one item', () => {
        const long = Array.from({ length: 4 }, (_, n) => ({ id: n, text: prose(3_000, `Long ${n}.`) }));
        const other = Array.from({ length: 4 }, (_, n) => ({ id: n, text: prose(2_900, `Other ${n}.`) }));
        const text = fitAppAnswer({ long, other }, 7_000);
        const read = JSON.parse(text);
        expect(text.length).toBeLessThanOrEqual(7_000);
        expect(read.long.length).toBeGreaterThanOrEqual(1);
        expect(read.other.length).toBeGreaterThanOrEqual(1);
        expect(read.long_note || read.other_note).toBeDefined();
    });

    it('cuts what cannot be shortened (one item, or no list) with the chat notice, never silently', () => {
        const one = { id: 1, text: prose(200_000) };
        const text = fitAppAnswer({ items: [one] });
        expect(text).toContain('Only the first 80,000 of ');
        expect(text).toMatch(/characters fit in this reply's room for tool results/);
        const plain = fitAppAnswer(prose(250_000));
        expect(plain.startsWith(prose(RUN_ANSWER_MAX))).toBe(true);
        expect(plain).toContain('Only the first 80,000 of 250,000 characters fit');
    });

    it('never ends in half an emoji when it cuts', () => {
        const text = cutWithNote('😀'.repeat(60_000), 80_001);
        expect(text).toContain('Only the first');
        expect(text).not.toMatch(/[\uD800-\uDBFF]\n/);
    });
});

describe('cutWithNote', () => {
    it('leaves a text that fits alone, and says how much was kept when it cuts', () => {
        expect(cutWithNote('short')).toBe('short');
        expect(cutWithNote('abcdef', 4)).toMatch(/^abcd\n\[Only the first 4 of 6 characters fit/);
    });
});
