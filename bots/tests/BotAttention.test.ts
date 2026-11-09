/**
 * Who a bot listens to when several people are in its nearby chat (game #1220, option b): the person who says its
 * name, who summoned it, or whom it answered inside the follow-up window. Alone with one person, everything is for it.
 */
import { describe, expect, it } from 'vitest';
import { BotAttention, DEFAULT_FOLLOW_UP_SECONDS, followUpSeconds } from '../client/BotAttention';

const SPACE = 'proximity-1';
const KHALID = 7;
const SARA = 8;

function setup(name = 'Sales Researcher', seconds = 30) {
    let now = 1_000_000;
    const summonedTo = new Set<number>();
    const busyWith = new Set<number>();
    const attention = new BotAttention(name, seconds, (id) => summonedTo.has(id), (id) => busyWith.has(id), () => now);
    return { attention, summonedTo, busyWith, advance: (ms: number) => (now += ms) };
}

describe('BotAttention', () => {
    it('hears everything from a person who is on their own with the bot, as it always did', () => {
        const { attention } = setup();
        attention.personJoined(SPACE, KHALID);
        expect(attention.attention(SPACE, KHALID, 'what is the weather?')).toBe('alone');
        expect(attention.hears(SPACE, KHALID, 'what is the weather?')).toBe(true);
    });

    it('does not take a bubble it has not seen for company', () => {
        const { attention } = setup();
        attention.personJoined(SPACE, KHALID);
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

    it('hears a person who calls it in Arabic, French or Spanish (#1856)', () => {
        const { attention } = setup('Nora');
        attention.personJoined(SPACE, KHALID);
        attention.personJoined(SPACE, SARA);
        for (const line of ['يا Nora وين الاجتماع؟', 'Ya Nora, where is the meeting?', 'أهلا Nora', 'Salut Nora, ça va ?', 'Hé Nora', 'Hola Nora, ¿qué tal?', 'Oye Nora']) {
            expect(attention.attention(SPACE, SARA, line), line).toBe('named');
        }
        const arabic = setup('نورة').attention;
        for (const id of [KHALID, SARA]) arabic.personJoined(SPACE, id);
        for (const line of ['يا نورة، وين غرفة الاجتماعات؟', 'نورة شنو رايج؟', 'يا نُورَة']) {
            expect(arabic.attention(SPACE, SARA, line), line).toBe('named');
        }
        // A calling word with someone else's name is not for the bot
        expect(arabic.hears(SPACE, SARA, 'يا خالد تعال')).toBe(false);
        expect(attention.hears(SPACE, SARA, 'Hola Khalid')).toBe(false);
    });

    it("uses Orbit's follow-up window once it is given, and ignores one that isn't a usable number (#1857)", () => {
        let now = 1_000_000;
        const attention = new BotAttention('Nora', 30, () => false, () => false, () => now);
        attention.personJoined(SPACE, KHALID);
        attention.personJoined(SPACE, SARA);
        attention.answered(SPACE, SARA);
        now += 45_000;
        expect(attention.attention(SPACE, SARA, 'and then?')).toBe('ignored');
        attention.useFollowUpSeconds(60);
        expect(attention.followUpSeconds).toBe(60);
        expect(attention.attention(SPACE, SARA, 'and then?')).toBe('follow-up');
        for (const bad of [-1, 1.5, Number.NaN, 24 * 60 * 60 + 1]) attention.useFollowUpSeconds(bad);
        expect(attention.followUpSeconds).toBe(60);
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

    it('keeps listening to a person while it is still answering them or has their line waiting, then by the window', () => {
        const { attention, busyWith, advance } = setup('Nora', 30);
        attention.personJoined(SPACE, KHALID);
        attention.personJoined(SPACE, SARA);
        busyWith.add(KHALID);
        // A long answer (tools, a slow model): well past the window, and the person adds to the ask
        advance(120_000);
        expect(attention.attention(SPACE, KHALID, 'and make it short')).toBe('follow-up');
        expect(attention.attention(SPACE, SARA, 'and make it short')).toBe('ignored');
        // The answer is done: the window starts from now
        busyWith.delete(KHALID);
        attention.answered(SPACE, KHALID);
        advance(29_000);
        expect(attention.attention(SPACE, KHALID, 'thanks')).toBe('follow-up');
        advance(2_000);
        expect(attention.attention(SPACE, KHALID, 'thanks')).toBe('ignored');
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

describe('a person who says they are done (#1670)', () => {
    it('needs the name again at once, and nobody else loses their window', () => {
        const { attention } = setup();
        for (const id of [KHALID, SARA]) {
            attention.personJoined(SPACE, id);
            attention.answered(SPACE, id);
        }
        expect(attention.attention(SPACE, KHALID, 'and one more thing')).toBe('follow-up');

        attention.ended(SPACE, KHALID);
        expect(attention.attention(SPACE, KHALID, 'and one more thing')).toBe('ignored');
        expect(attention.attention(SPACE, KHALID, 'Sales Researcher, one more thing')).toBe('named');
        expect(attention.attention(SPACE, SARA, 'and one more thing')).toBe('follow-up');
    });

    it('opens a window again only when they say the name and the bot then answers them', () => {
        const { attention } = setup();
        attention.personJoined(SPACE, KHALID);
        attention.personJoined(SPACE, SARA);
        attention.answered(SPACE, KHALID);
        attention.ended(SPACE, KHALID);
        // An answer that was still on its way does not bring them back
        attention.answered(SPACE, KHALID);
        expect(attention.attention(SPACE, KHALID, 'go on')).toBe('ignored');
        // The name does, and the answer to it opens the window as it always does
        expect(attention.hears(SPACE, KHALID, 'Sales Researcher, go on')).toBe(true);
        expect(attention.hears(SPACE, KHALID, 'go on')).toBe(false);
        attention.answered(SPACE, KHALID);
        expect(attention.attention(SPACE, KHALID, 'go on')).toBe('follow-up');
    });

    it('does not take their talk for the bot\'s while it is still busy with a line of theirs', () => {
        const { attention, busyWith } = setup();
        attention.personJoined(SPACE, KHALID);
        attention.personJoined(SPACE, SARA);
        busyWith.add(KHALID);
        attention.ended(SPACE, KHALID);
        expect(attention.attention(SPACE, KHALID, 'so as I was saying')).toBe('ignored');
        expect(attention.attention(SPACE, SARA, 'so as I was saying')).toBe('ignored');
        busyWith.add(SARA);
        expect(attention.attention(SPACE, SARA, 'so as I was saying')).toBe('follow-up');
    });

    it('a summon still wins, and leaving the bubble forgets it', () => {
        const { attention, summonedTo } = setup();
        attention.personJoined(SPACE, KHALID);
        attention.personJoined(SPACE, SARA);
        attention.ended(SPACE, KHALID);
        summonedTo.add(KHALID);
        expect(attention.attention(SPACE, KHALID, 'anything')).toBe('summoned');
        summonedTo.delete(KHALID);
        attention.personLeft(SPACE, KHALID);
        attention.personJoined(SPACE, KHALID);
        attention.answered(SPACE, KHALID);
        expect(attention.attention(SPACE, KHALID, 'anything')).toBe('follow-up');
    });

    it('can end something only when others are here and the bot is not on a summon to the person', () => {
        const { attention, summonedTo } = setup();
        attention.personJoined(SPACE, KHALID);
        expect(attention.endable(SPACE, KHALID)).toBe(false);
        attention.personJoined(SPACE, SARA);
        expect(attention.endable(SPACE, KHALID)).toBe(true);
        summonedTo.add(KHALID);
        expect(attention.endable(SPACE, KHALID)).toBe(false);
        expect(attention.endable(SPACE, SARA)).toBe(true);
    });
});

describe('a voice note in the bubble: who it is for', () => {
    it('is for the bot when the person is on their own with it', () => {
        const { attention } = setup();
        attention.personJoined(SPACE, KHALID);
        expect(attention.noteIsForBot(SPACE, KHALID, false)).toBe(true);
    });

    it('is not for the bot in a group just because the bot answered the person a moment ago', () => {
        const { attention } = setup();
        attention.personJoined(SPACE, KHALID);
        attention.personJoined(SPACE, SARA);
        attention.answered(SPACE, KHALID);
        // A typed line would be let through by the follow-up window, a note never is
        expect(attention.attention(SPACE, KHALID, 'and one more thing')).toBe('follow-up');
        expect(attention.noteIsForBot(SPACE, KHALID, false)).toBe(false);
    });

    it('is not for the bot in a group when it only names the bot in a caption', () => {
        // The caption is no proof it is meant for the bot: only a reply to the bot's own message or a summon counts
        const { attention } = setup();
        attention.personJoined(SPACE, KHALID);
        attention.personJoined(SPACE, SARA);
        expect(attention.noteIsForBot(SPACE, SARA, false)).toBe(false);
    });

    it('is for the bot in a group when it replies to the bot, and that brings back someone who said they were done', () => {
        const { attention } = setup();
        attention.personJoined(SPACE, KHALID);
        attention.personJoined(SPACE, SARA);
        attention.ended(SPACE, KHALID);
        expect(attention.noteIsForBot(SPACE, KHALID, true)).toBe(true);
        expect(attention.attention(SPACE, KHALID, 'go on')).toBe('ignored');
        attention.answered(SPACE, KHALID);
        expect(attention.attention(SPACE, KHALID, 'go on')).toBe('follow-up');
    });

    it('is for the bot in a group when the bot is summoned to the person', () => {
        const { attention, summonedTo } = setup();
        attention.personJoined(SPACE, KHALID);
        attention.personJoined(SPACE, SARA);
        summonedTo.add(KHALID);
        expect(attention.noteIsForBot(SPACE, KHALID, false)).toBe(true);
        expect(attention.noteIsForBot(SPACE, SARA, false)).toBe(false);
    });
});

describe('a person who asks the bot to keep listening in a group (round 8)', () => {
    it('gets one fresh follow-up window, as if they had said its name, which ends like any other', () => {
        const { attention, advance } = setup();
        attention.personJoined(SPACE, KHALID);
        attention.personJoined(SPACE, SARA);
        expect(attention.attention(SPACE, KHALID, 'disco, in Arabic')).toBe('ignored');
        attention.listenGranted(SPACE, KHALID);
        expect(attention.attention(SPACE, KHALID, 'disco, in Arabic')).toBe('follow-up');
        expect(attention.attention(SPACE, SARA, 'disco, in Arabic')).toBe('ignored');
        advance(31_000);
        expect(attention.attention(SPACE, KHALID, 'disco, in Arabic')).toBe('ignored');
    });

    it('brings back someone who had said they were done', () => {
        const { attention } = setup();
        attention.personJoined(SPACE, KHALID);
        attention.personJoined(SPACE, SARA);
        attention.ended(SPACE, KHALID);
        attention.listenGranted(SPACE, KHALID);
        expect(attention.attention(SPACE, KHALID, 'go on')).toBe('follow-up');
    });
});
