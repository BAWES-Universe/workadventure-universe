/**
 * The words around a card in nearby chat and voice (#1658): a line made from the tool's title and a name only, and the
 * title as it is when the extra AI reply fails or says more than it was given.
 */
import { describe, expect, it } from 'vitest';
import { acceptLine, fallbackLine, isConfirm, nameForLine, tapInstead, wordsPrompt } from '../NearbyWords';

describe('the line when the extra AI reply fails', () => {
    it('is the title as it is, at each of the four moments', () => {
        expect(fallbackLine('ask', 'Khalid', 'Send email')).toBe('Khalid, I need your OK for Send email.');
        expect(fallbackLine('changed', 'Khalid', 'Send email')).toBe('Khalid, I changed Send email and need your OK again.');
        expect(fallbackLine('sent', 'Khalid', 'Send email')).toBe('Khalid, Send email is done.');
        expect(fallbackLine('notDone', 'Khalid', 'Send email')).toBe('Khalid, Send email was not done.');
    });

    it('starts with a capital when there is no name', () => {
        expect(fallbackLine('ask', null, 'send email')).toBe('I need your OK for send email.');
    });
});

describe('the name a line starts with', () => {
    it('is one tidy line, and none when the person has no name', () => {
        expect(nameForLine('  Khalid  ')).toBe('Khalid');
        expect(nameForLine('Kha,lid: "K"')).toBe('Khalid K');
        expect(nameForLine('')).toBeNull();
        expect(nameForLine(null)).toBeNull();
        expect(nameForLine('x'.repeat(100))).toHaveLength(40);
    });
});

describe('the extra AI reply', () => {
    it('is given only the title and the name', () => {
        const prompt = wordsPrompt('ask', 'Khalid', 'Send email');
        expect(prompt).toContain('Tool: Send email');
        expect(prompt).toContain('Person: Khalid');
        expect(prompt).not.toMatch(/Fahad|launch/);
    });

    it('is taken when it is one short line that starts with the name', () => {
        expect(acceptLine('Khalid, I need your OK to send an email for you.', 'Khalid', [], 'Send email')).toBe('Khalid, I need your OK to send an email for you.');
        expect(acceptLine('"Khalid, I sent the email for you."', 'Khalid')).toBe('Khalid, I sent the email for you.');
        expect(acceptLine("Khalid, I didn't send the email.", 'khalid')).toBe("Khalid, I didn't send the email.");
    });

    it('is refused when it does not fit, so the title takes its place', () => {
        const bad = [
            '',
            'Sara, I need your OK to send an email.',
            'I need your OK to send an email.',
            'Khalid, I need your OK.\nAlso check the room.',
            'Khalid, I need your OK. Then I will send it. Thanks.',
            `Khalid, ${'long '.repeat(40)}`,
            'Khalid, see https://example.com for the email.',
            'Khalid, I need your OK to send an email to a@b.co.',
            'Khalid, I need your OK to send 3 emails.',
        ];
        for (const line of bad) expect(acceptLine(line, 'Khalid')).toBeNull();
        expect(acceptLine(undefined, 'Khalid')).toBeNull();
    });

    it('is refused when it holds a word of the card, whatever wrote it', () => {
        const card = ['Fahad at Alghanim', 'New launch date', 'Hi Fahad, our launch moves two weeks.'];
        expect(acceptLine('Khalid, I need your OK to tell Fahad about the launch.', 'Khalid', card, 'Send email')).toBeNull();
        expect(acceptLine('Khalid, I need your OK to send an email for you.', 'Khalid', card, 'Send email')).not.toBeNull();
        // A word of the tool's own title is fine even when the card says it too
        expect(acceptLine('Khalid, I need your OK to send an email for you.', 'Khalid', ['A long email body'], 'Send email')).not.toBeNull();
    });
});

describe('a yes while a card waits', () => {
    it('is told from anything else by one word', () => {
        expect(isConfirm('CONFIRM')).toBe(true);
        expect(isConfirm('  confirm.')).toBe(true);
        expect(isConfirm('OTHER')).toBe(false);
        expect(isConfirm('')).toBe(false);
        expect(isConfirm(undefined)).toBe(false);
    });

    it('is answered by pointing at the button, never by sending', () => {
        expect(tapInstead('Send email')).toBe('Tap Send email on the card to go ahead. A yes in chat or out loud never does it.');
    });
});
