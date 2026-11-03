/**
 * Who a bot listens to when several people are in its nearby chat (game #1220, option b): the person who says its
 * name, who summoned it, or whom it answered inside the follow-up window. Alone with one person, everything is for it.
 */
import { describe, expect, it } from 'vitest';
import { BotAttention, DEFAULT_FOLLOW_UP_SECONDS, followUpSeconds } from '../client/BotAttention';

const SPACE = 'proximity-1';
const KHALID = 7;
const SARA = 8;
const OTHER_BOT = 50;

function setup(name = 'Sales Researcher', seconds = 30) {
    let now = 1_000_000;
    const summonedTo = new Set<number>();
    const attention = new BotAttention(name, seconds, (id) => id !== OTHER_BOT, (id) => summonedTo.has(id), () => now);
    return { attention, summonedTo, advance: (ms: number) => (now += ms) };
}

describe('BotAttention', () => {
    it('hears everything from a person who is on their own with the bot, as it always did', () => {
        const { attention } = setup();
        attention.personJoined(SPACE, KHALID);
        expect(attention.attention(SPACE, KHALID, 'what is the weather?')).toBe('alone');
        expect(attention.hears(SPACE, KHALID, 'what is the weather?')).toBe(true);
    });

    it('does not take another bot, or a bubble it has not seen, for company', () => {
        const { attention } = setup();
        attention.personJoined(SPACE, KHALID);
        attention.personJoined(SPACE, OTHER_BOT);
        expect(attention.attention(SPACE, KHALID, 'hello')).toBe('alone');
        expect(attention.attention('unseen', KHALID, 'hello')).toBe('alone');
    });

    it('drops what a person says in a group unless it is for the bot', () => {
        const { attention } = setup();
        attention.personJoined(SPACE, KHALID);
        attention.personJoined(SPACE, SARA);
        expect(attention.attention(SPACE, SARA, 'Khalid, lunch at one?')).toBe('ignored');
        expect(attention.hears(SPACE, SARA, 'Khalid, lunch at one?')).toBe(false);
    });

    it('hears a person who starts with its name, with or without a calling word, case, accents or an @', () => {
        const { attention } = setup('Núra');
        attention.personJoined(SPACE, KHALID);
        attention.personJoined(SPACE, SARA);
        for (const line of ['Nura, what do you think?', 'hey nura what do you think', 'Hi, @Núra: what now', 'OK Nura', 'nura']) {
            expect(attention.attention(SPACE, SARA, line), line).toBe('named');
        }
    });

    it('does not take the name in the middle of a line, or inside another word, for being called', () => {
        const { attention } = setup('Nora');
        attention.personJoined(SPACE, KHALID);
        attention.personJoined(SPACE, SARA);
        for (const line of ['Khalid, ask Nora about it', 'did Nora say that?', 'Norah is here', 'Noralee, hi', 'hey you', '']) {
            expect(attention.hears(SPACE, SARA, line), line).toBe(false);
        }
    });

    it('matches a name of several words, and never an empty name', () => {
        const a = setup('Sales Researcher').attention;
        for (const id of [KHALID, SARA]) a.personJoined(SPACE, id);
        expect(a.hears(SPACE, SARA, 'Sales Researcher, what do you think?')).toBe(true);
        expect(a.hears(SPACE, SARA, 'Sales, what do you think?')).toBe(false);
        const b = setup('  ').attention;
        for (const id of [KHALID, SARA]) b.personJoined(SPACE, id);
        expect(b.hears(SPACE, SARA, 'anything')).toBe(false);
    });

    it('keeps listening to the person it answered, for the follow-up window only, and renews it with each answer', () => {
        const { attention, advance } = setup('Nora', 30);
        attention.personJoined(SPACE, KHALID);
        attention.personJoined(SPACE, SARA);
        attention.answered(SPACE, KHALID);
        advance(29_000);
        expect(attention.attention(SPACE, KHALID, 'and tomorrow?')).toBe('follow-up');
        // Sara was not answered: she is not in the window
        expect(attention.attention(SPACE, SARA, 'and tomorrow?')).toBe('ignored');
        attention.answered(SPACE, KHALID);
        advance(29_000);
        expect(attention.attention(SPACE, KHALID, 'and the day after?')).toBe('follow-up');
        advance(2_000);
        expect(attention.attention(SPACE, KHALID, 'and the day after?')).toBe('ignored');
    });

    it('needs the name every time when the window is 0', () => {
        const { attention } = setup('Nora', 0);
        attention.personJoined(SPACE, KHALID);
        attention.personJoined(SPACE, SARA);
        attention.answered(SPACE, KHALID);
        expect(attention.hears(SPACE, KHALID, 'and tomorrow?')).toBe(false);
    });

    it('keeps a window when a second person arrives, so the first is not cut off mid-conversation', () => {
        const { attention } = setup('Nora', 30);
        attention.personJoined(SPACE, KHALID);
        attention.answered(SPACE, KHALID);
        attention.personJoined(SPACE, SARA);
        expect(attention.attention(SPACE, KHALID, 'go on')).toBe('follow-up');
    });

    it('hears the person it is summoned to for as long as the summon lasts, and not once it has ended', () => {
        const { attention, summonedTo, advance } = setup('Nora', 30);
        attention.personJoined(SPACE, KHALID);
        attention.personJoined(SPACE, SARA);
        summonedTo.add(KHALID);
        advance(120_000);
        expect(attention.attention(SPACE, KHALID, 'thanks for coming')).toBe('summoned');
        expect(attention.attention(SPACE, SARA, 'thanks for coming')).toBe('ignored');
        // The summon ended (they left, or walked far away): nothing of it is left behind
        summonedTo.delete(KHALID);
        expect(attention.attention(SPACE, KHALID, 'one more thing')).toBe('ignored');
    });

    it('forgets a person, and the whole bubble, when they leave', () => {
        const { attention } = setup('Nora', 30);
        attention.personJoined(SPACE, KHALID);
        attention.personJoined(SPACE, SARA);
        attention.answered(SPACE, KHALID);
        attention.personLeft(SPACE, KHALID);
        // Khalid is back, now the only one besides Sara who left: still no window from before
        attention.personJoined(SPACE, KHALID);
        expect(attention.attention(SPACE, KHALID, 'hello again')).toBe('ignored');
        attention.personLeft(SPACE, SARA);
        expect(attention.attention(SPACE, KHALID, 'hello again')).toBe('alone');
        attention.personJoined(SPACE, SARA);
        attention.spaceLeft(SPACE);
        expect(attention.attention(SPACE, KHALID, 'hello again')).toBe('alone');
    });

    it('asking about a line does not change what the next question says', () => {
        const { attention } = setup('Nora', 30);
        attention.personJoined(SPACE, KHALID);
        attention.personJoined(SPACE, SARA);
        for (let i = 0; i < 3; i++) expect(attention.hears(SPACE, SARA, 'lunch?')).toBe(false);
        for (let i = 0; i < 3; i++) expect(attention.hears(SPACE, SARA, 'Nora, lunch?')).toBe(true);
        expect(attention.hears(SPACE, SARA, 'and then?')).toBe(false);
    });
});

describe('followUpSeconds', () => {
    it('is 30 seconds unless BOT_FOLLOW_UP_SECONDS says another whole number', () => {
        expect(DEFAULT_FOLLOW_UP_SECONDS).toBe(30);
        expect(followUpSeconds({})).toBe(30);
        expect(followUpSeconds({ BOT_FOLLOW_UP_SECONDS: '45' })).toBe(45);
        expect(followUpSeconds({ BOT_FOLLOW_UP_SECONDS: ' 10 ' })).toBe(10);
        expect(followUpSeconds({ BOT_FOLLOW_UP_SECONDS: '0' })).toBe(0);
    });

    it('falls back to the default for anything else', () => {
        for (const bad of ['', 'abc', '-5', '1.5', '10s', '999999999']) {
            expect(followUpSeconds({ BOT_FOLLOW_UP_SECONDS: bad }), bad).toBe(30);
        }
    });
});
