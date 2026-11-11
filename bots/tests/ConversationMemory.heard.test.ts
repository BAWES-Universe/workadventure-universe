/**
 * Each thing a bot remembers carries where it was said (game #1993), and a reply other people read is built without
 * what they were not there for. Private is decided by the place, never by the topic, and never by a model.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationMemory } from '../memory/ConversationMemory';
import { PersistentMemory } from '../memory/PersistentMemory';
import { SOMEONE_UNKNOWN, heardAlso, heardInDm, mayUse, namedOthers, viewFor, type Heard } from '../memory/Heard';

const BOT = 'bot-1';
const KHALID = 7;
const DM = 'matrix-dm';
const BUBBLE = 'bubble-space';
const SARA = 'uuid-sara';
const OMAR = 'uuid-omar';
const OTHER_BOT = 'bot-other';

/** A memory that is told where each line is said: a direct message, or the bubble with whoever `others` names. */
function memoryWith(others: { now: string[] }, memory: ConversationMemory = new ConversationMemory()): ConversationMemory {
    memory.useHeard((_botId, _playerId, spaceName) => (spaceName === DM ? heardInDm() : { place: 'nearby', with: [...others.now] }));
    return memory;
}

describe('mayUse: what a reply may be built from', () => {
    const inDm: Heard = { place: 'dm', with: [] };
    const alone: Heard = { place: 'nearby', with: [] };
    const withSara: Heard = { place: 'nearby', with: [SARA] };

    it('uses everything for the person alone', () => {
        for (const heard of [inDm, alone, withSara, undefined]) expect(mayUse(heard, 'all')).toBe(true);
    });

    it('keeps a direct message, a talk alone and anything with no place out of a reply others read', () => {
        for (const heard of [inDm, alone, undefined]) expect(mayUse(heard, { present: [SARA] })).toBe(false);
    });

    it('uses what everyone here was there for, and nothing one of them was not', () => {
        expect(mayUse(withSara, { present: [SARA] })).toBe(true);
        expect(mayUse(withSara, { present: [SARA, OMAR] })).toBe(false);
        expect(mayUse({ place: 'nearby', with: [SARA, OMAR] }, { present: [OMAR] })).toBe(true);
    });

    it('opens nothing to someone the bot cannot name, even where someone unnamed was there before', () => {
        expect(mayUse(withSara, { present: [SOMEONE_UNKNOWN] })).toBe(false);
        expect(mayUse({ place: 'nearby', with: [SOMEONE_UNKNOWN] }, { present: [SOMEONE_UNKNOWN] })).toBe(false);
    });

    it('opens nothing to a view that names nobody: that is never how "alone" is said', () => {
        expect(mayUse(withSara, { present: [] })).toBe(false);
    });

    it('reads a stamp it does not understand as private', () => {
        expect(mayUse({ place: 'elsewhere', with: [SARA] } as unknown as Heard, { present: [SARA] })).toBe(false);
        expect(mayUse({ place: 'nearby' } as unknown as Heard, { present: [SARA] })).toBe(false);
    });

    it('adds whoever hears the same thing again', () => {
        expect(heardAlso(inDm, withSara)).toEqual({ place: 'nearby', with: [SARA] });
        expect(heardAlso(withSara, inDm)).toEqual({ place: 'nearby', with: [SARA] });
        expect(heardAlso(withSara, { place: 'nearby', with: [OMAR] })).toEqual({ place: 'nearby', with: [SARA, OMAR] });
        expect(heardAlso(withSara, undefined)).toEqual(withSara);
        expect(heardAlso(undefined, undefined)).toBeUndefined();
    });
});

describe('ConversationMemory: what a bot says in front of others', () => {
    let others: { now: string[] };
    let memory: ConversationMemory;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-11T09:00:00Z'));
        others = { now: [] };
        memory = memoryWith(others);
        memory.startConversation(BOT, KHALID);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function say(line: string, sender: 'person' | 'bot', spaceName: string): void {
        vi.advanceTimersByTime(1000);
        memory.addMessage(BOT, KHALID, line, sender, spaceName);
    }

    it('stamps each line with where it was said and who else was there', () => {
        say('Keep this between us: I have an interview at Agility tomorrow at 10', 'person', DM);
        say('Good luck! It stays between us.', 'bot', DM);
        say('What is this room for?', 'person', BUBBLE);
        others.now = [SARA];
        say('Hi both!', 'bot', BUBBLE);

        expect(memory.getMemory(BOT, KHALID)!.conversationHistory.map((line) => line.heard)).toEqual([
            { place: 'dm', with: [] },
            { place: 'dm', with: [] },
            { place: 'nearby', with: [] },
            { place: 'nearby', with: [SARA] },
        ]);
    });

    it('alone, the bot reads everything: the direct message is there on the map', () => {
        say('I have an interview at Agility tomorrow at 10', 'person', DM);

        expect(memory.getConversationContext(BOT, KHALID)).toContain('interview at Agility');
        expect(memory.getConversationContext(BOT, KHALID, 'all')).toContain('interview at Agility');
    });

    it('with someone else there, a line from a direct message is not in what the reply is built from', () => {
        say('I have an interview at Agility tomorrow at 10', 'person', DM);
        say('Good luck! It stays between us.', 'bot', DM);

        const shared = memory.getConversationContext(BOT, KHALID, { present: [SARA] });

        expect(shared).not.toContain('Agility');
        expect(shared).not.toContain('between us');
        expect(shared).not.toContain('Recent conversation');
        expect(memory.leavesOut(BOT, KHALID, { present: [SARA] })).toBe(true);
    });

    it('a line said on the map with nobody else there is private too', () => {
        say('My salary is 2,000', 'person', BUBBLE);

        expect(memory.getConversationContext(BOT, KHALID, { present: [SARA] })).not.toContain('salary');
    });

    it('what was said in front of Sara can be said in front of Sara again, and not in front of Omar', () => {
        others.now = [SARA];
        say('The demo is on Thursday', 'person', BUBBLE);
        say('Noted: Thursday.', 'bot', BUBBLE);

        expect(memory.getConversationContext(BOT, KHALID, { present: [SARA] })).toContain('The demo is on Thursday');
        expect(memory.getConversationContext(BOT, KHALID, { present: [SARA] })).toContain('Noted: Thursday.');
        expect(memory.getConversationContext(BOT, KHALID, { present: [SARA, OMAR] })).not.toContain('Thursday');
        expect(memory.getConversationContext(BOT, KHALID, { present: [OMAR] })).not.toContain('Thursday');
    });

    it('counts a guest and another bot like anyone else', () => {
        others.now = [SARA];
        say('The demo is on Thursday', 'person', BUBBLE);

        expect(memory.getConversationContext(BOT, KHALID, { present: [SARA, OTHER_BOT] })).not.toContain('Thursday');
        expect(memory.getConversationContext(BOT, KHALID, { present: [SARA, 'guest-uuid'] })).not.toContain('Thursday');
    });

    it('opens nothing when the bot cannot tell who is there', () => {
        others.now = [SARA];
        say('The demo is on Thursday', 'person', BUBBLE);

        expect(memory.getConversationContext(BOT, KHALID, { present: [SOMEONE_UNKNOWN] })).not.toContain('Thursday');
    });

    it('nothing is left out when everything was said in front of the people here', () => {
        others.now = [SARA];
        say('The demo is on Thursday', 'person', BUBBLE);

        expect(memory.leavesOut(BOT, KHALID, { present: [SARA] })).toBe(false);
        expect(memory.leavesOut(BOT, KHALID, 'all')).toBe(false);
    });

    it('reads no further back with others there than it does alone', () => {
        memory.setHistoryWindow(BOT, 2);
        others.now = [SARA];
        say('The demo is on Thursday', 'person', BUBBLE);
        others.now = [];
        say('one', 'person', DM);
        say('two', 'bot', DM);

        // The two lines the bot reads are private; the older open one is out of its window either way
        expect(memory.getConversationContext(BOT, KHALID)).not.toContain('Thursday');
        expect(memory.getConversationContext(BOT, KHALID, { present: [SARA] })).not.toContain('Thursday');
    });

    it('keeps what it learned in private about the person out of a shared reply', () => {
        say("My name is Kiko and I love karak tea. My birthday is March 3. I'm nervous", 'person', DM);

        const alone = memory.getConversationContext(BOT, KHALID);
        expect(alone).toContain('Their name is Kiko');
        expect(alone).toContain('karak tea');
        expect(alone).toContain('March 3');
        expect(alone).toContain("they're nervous");

        const shared = memory.getConversationContext(BOT, KHALID, { present: [SARA] });
        for (const secret of ['Kiko', 'karak', 'March 3', 'nervous', 'birthday']) expect(shared).not.toContain(secret);
        expect(shared).toContain('this person');
    });

    it('says in front of Sara what the person told it in front of Sara', () => {
        others.now = [SARA];
        say('My name is Kiko and I love karak tea', 'person', BUBBLE);

        const shared = memory.getConversationContext(BOT, KHALID, { present: [SARA] });
        expect(shared).toContain('Their name is Kiko');
        expect(shared).toContain('karak tea');
        expect(memory.getConversationContext(BOT, KHALID, { present: [OMAR] })).not.toContain('Kiko');
    });

    it('a thing told in private and then said again in front of Sara is open to Sara from then on', () => {
        say('I love karak tea', 'person', DM);
        expect(memory.getConversationContext(BOT, KHALID, { present: [SARA] })).not.toContain('They like');

        others.now = [SARA];
        say('I love karak tea', 'person', BUBBLE);
        others.now = [OMAR];
        say('I love karak tea', 'person', BUBBLE);

        expect(memory.getConversationContext(BOT, KHALID, { present: [SARA] })).toContain('They like: karak tea');
        expect(memory.getConversationContext(BOT, KHALID, { present: [SARA, OMAR] })).toContain('They like: karak tea');
    });

    it('a thing that changes in private is private again', () => {
        others.now = [SARA];
        say("I'm happy", 'person', BUBBLE);
        expect(memory.getConversationContext(BOT, KHALID, { present: [SARA] })).toContain("they're happy");

        others.now = [];
        say("I'm scared", 'person', DM);

        const shared = memory.getConversationContext(BOT, KHALID, { present: [SARA] });
        expect(shared).not.toContain('scared');
        expect(shared).not.toContain("they're happy");
        expect(memory.getConversationContext(BOT, KHALID)).toContain("they're scared");
    });

    it('learns nothing open from a line whose place it is not told', () => {
        others.now = [SARA];
        memory.extractPersonalInfo(BOT, KHALID, 'My name is Kiko');

        expect(memory.getConversationContext(BOT, KHALID, { present: [SARA] })).not.toContain('Kiko');
        expect(memory.getConversationContext(BOT, KHALID)).toContain('Kiko');
    });

    it('stamps what it learns when it is told the space', () => {
        others.now = [SARA];
        memory.extractPersonalInfo(BOT, KHALID, 'My name is Kiko', BUBBLE);

        expect(memory.getMemory(BOT, KHALID)!.personalInfo.heard).toEqual({ name: { place: 'nearby', with: [SARA] } });
        expect(memory.getConversationContext(BOT, KHALID, { present: [SARA] })).toContain('Kiko');
    });

    it('a wound from a private talk, and the moment it is kept as, stay out of a shared reply', () => {
        say('You are useless', 'person', DM);
        memory.updateEmotionsFromAI(BOT, KHALID, { personSentiment: -90, isInsult: true, insultSeverity: 8, context: 'angry' });

        expect(memory.getConversationContext(BOT, KHALID)).toContain('EMOTIONAL WOUNDS');
        const shared = memory.getConversationContext(BOT, KHALID, { present: [SARA] });
        expect(shared).not.toContain('EMOTIONAL WOUNDS');
        expect(shared).not.toContain('AI detected');
        expect(shared).not.toContain('NOT forgiven');
        // The bot's own note that they have met says nothing anyone said: any reply may use it
        expect(shared).toContain('Notable moments: First conversation with player.');
    });

    it('a wound from something said in front of Sara is known in front of Sara', () => {
        others.now = [SARA];
        say('You are useless', 'person', BUBBLE);
        memory.updateEmotionsFromAI(BOT, KHALID, { personSentiment: -90, isInsult: true, insultSeverity: 8, context: 'angry' });

        expect(memory.getConversationContext(BOT, KHALID, { present: [SARA] })).toContain('EMOTIONAL WOUNDS');
        expect(memory.getConversationContext(BOT, KHALID, { present: [OMAR] })).not.toContain('EMOTIONAL WOUNDS');
    });

    it('a wound after a private line and a line in front of Sara, both still unanswered, is not known in front of Sara', () => {
        say('hello', 'person', BUBBLE);
        say('Hello!', 'bot', BUBBLE);
        // Said alone, and before the answer comes Sara walks up and they write again
        say('You are useless', 'person', BUBBLE);
        others.now = [SARA];
        say('anyway, what is for lunch?', 'person', BUBBLE);
        memory.updateEmotionsFromAI(BOT, KHALID, { personSentiment: -90, isInsult: true, insultSeverity: 8, context: 'angry' });

        expect(memory.getConversationContext(BOT, KHALID)).toContain('EMOTIONAL WOUNDS');
        expect(memory.getConversationContext(BOT, KHALID, { present: [SARA] })).not.toContain('EMOTIONAL WOUNDS');
    });

    it('a wound after two unanswered lines is known to those who heard both, also once the answer is kept', () => {
        others.now = [SARA, OMAR];
        say('You are useless', 'person', BUBBLE);
        others.now = [SARA];
        say('really useless', 'person', BUBBLE);
        say('I am sorry you feel that way.', 'bot', BUBBLE);
        memory.updateEmotionsFromAI(BOT, KHALID, { personSentiment: -90, isInsult: true, insultSeverity: 8, context: 'angry' });

        expect(memory.getConversationContext(BOT, KHALID, { present: [SARA] })).toContain('EMOTIONAL WOUNDS');
        expect(memory.getConversationContext(BOT, KHALID, { present: [OMAR] })).not.toContain('EMOTIONAL WOUNDS');
    });

    it('keeps a line with who heard it when it came, when it is kept a while after (its files were read first)', () => {
        // Sent alone; Sara walked up while the file was read
        const arrived = { heard: { place: 'nearby', with: [] } as Heard };
        others.now = [SARA];
        memory.addMessage(BOT, KHALID, 'My name is Kiko, here is my contract', 'person', BUBBLE, true, arrived);

        const kept = memory.getMemory(BOT, KHALID)!;
        expect(kept.conversationHistory.at(-1)!.heard).toEqual({ place: 'nearby', with: [] });
        expect(kept.personalInfo.heard?.name).toEqual({ place: 'nearby', with: [] });
        expect(memory.getConversationContext(BOT, KHALID, { present: [SARA] })).not.toContain('Kiko');
        // When who heard it could not be told then, it is private, whoever is here now
        memory.addMessage(BOT, KHALID, 'and the second page', 'person', BUBBLE, true, { heard: undefined });
        expect(kept.conversationHistory.at(-1)!.heard).toBeUndefined();
    });

    it('keeps how well it knows the person and how it feels: neither says what was said', () => {
        say('hello', 'person', DM);

        const shared = memory.getConversationContext(BOT, KHALID, { present: [SARA] });
        expect(shared).toContain('You just met this person for the first time.');
        expect(shared).toContain('still getting to know them');
    });

    it('treats everything remembered from before places were kept as private', () => {
        const old = new ConversationMemory();
        old.startConversation(BOT, KHALID);
        old.addMessage(BOT, KHALID, 'My name is Kiko and my interview is at 10', 'person', BUBBLE);

        expect(old.getMemory(BOT, KHALID)!.conversationHistory[0].heard).toBeUndefined();
        expect(old.getConversationContext(BOT, KHALID)).toContain('interview');
        const shared = old.getConversationContext(BOT, KHALID, { present: [SARA] });
        expect(shared).not.toContain('interview');
        expect(shared).not.toContain('Kiko');
    });

    it('keeps a line as private when telling who heard it fails', () => {
        const broken = new ConversationMemory();
        broken.useHeard(() => {
            throw new Error('no bubble');
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        broken.addMessage(BOT, KHALID, 'my interview is at 10', 'person', BUBBLE);
        warn.mockRestore();

        expect(broken.getMemory(BOT, KHALID)!.conversationHistory[0].heard).toBeUndefined();
        expect(broken.getConversationContext(BOT, KHALID, { present: [SARA] })).not.toContain('interview');
    });

    it('a stamp is the line\'s own: who is there later changes nothing about it', () => {
        const there = [SARA];
        memory.useHeard(() => ({ place: 'nearby', with: there }));
        say('The demo is on Thursday', 'person', BUBBLE);
        there.push(OMAR);

        expect(memory.getMemory(BOT, KHALID)!.conversationHistory[0].heard).toEqual({ place: 'nearby', with: [SARA] });
    });
});

describe('PersistentMemory: the place travels with the person', () => {
    const UUID = 'khalid-uuid';
    const MAP_PLAYER = 7;
    const DM_PLAYER = -1;
    let others: { now: string[] };
    let memory: PersistentMemory;

    beforeEach(() => {
        vi.useFakeTimers();
        others = { now: [] };
        memory = new PersistentMemory({ adminApiUrl: 'http://orbit.local', immediateSaveEnabled: false });
        memoryWith(others, memory);
        vi.spyOn(memory.getMemoryStorage(), 'saveMemory').mockResolvedValue(undefined as never);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('what was said in a direct message is private on the map, and still known there', () => {
        memory.setUserUuid(BOT, DM_PLAYER, UUID, true);
        vi.advanceTimersByTime(1000);
        memory.addMessage(BOT, DM_PLAYER, 'My name is Kiko and my interview at Agility is at 10', 'person', DM);
        vi.advanceTimersByTime(1000);
        memory.addMessage(BOT, DM_PLAYER, 'Good luck! It stays between us.', 'bot', DM);

        vi.advanceTimersByTime(60_000);
        memory.setUserUuid(BOT, MAP_PLAYER, UUID, true);

        expect(memory.getConversationContext(BOT, MAP_PLAYER)).toContain('interview at Agility');
        expect(memory.getConversationContext(BOT, MAP_PLAYER)).toContain('Their name is Kiko');
        const shared = memory.getConversationContext(BOT, MAP_PLAYER, { present: [SARA] });
        expect(shared).not.toContain('Agility');
        expect(shared).not.toContain('Kiko');
    });

    it('what was said in front of Sara on the map stays open to Sara after a direct message joins the two memories', () => {
        memory.setUserUuid(BOT, MAP_PLAYER, UUID, true);
        others.now = [SARA];
        vi.advanceTimersByTime(1000);
        memory.addMessage(BOT, MAP_PLAYER, 'My name is Kiko. The demo is on Thursday', 'person', BUBBLE);
        others.now = [];

        vi.advanceTimersByTime(60_000);
        memory.setUserUuid(BOT, DM_PLAYER, UUID, true);
        vi.advanceTimersByTime(1000);
        memory.addMessage(BOT, DM_PLAYER, 'my interview at Agility is at 10', 'person', DM);
        vi.advanceTimersByTime(60_000);
        memory.setUserUuid(BOT, MAP_PLAYER, UUID, true);

        const shared = memory.getConversationContext(BOT, MAP_PLAYER, { present: [SARA] });
        expect(shared).toContain('The demo is on Thursday');
        expect(shared).toContain('Their name is Kiko');
        expect(shared).not.toContain('Agility');
        expect(memory.getConversationContext(BOT, MAP_PLAYER)).toContain('Agility');
    });

    it('a copy of a memory has its own stamps', () => {
        memory.setUserUuid(BOT, MAP_PLAYER, UUID, true);
        others.now = [SARA];
        vi.advanceTimersByTime(1000);
        memory.addMessage(BOT, MAP_PLAYER, 'My name is Kiko', 'person', BUBBLE);
        vi.advanceTimersByTime(60_000);
        memory.setUserUuid(BOT, DM_PLAYER, UUID, true);

        // Told again in the direct message: the copy there may change, the map's own stamp may not
        const onMap = memory.getMemory(BOT, MAP_PLAYER)!.personalInfo.heard!.name;
        const inDm = memory.getMemory(BOT, DM_PLAYER)!.personalInfo.heard!.name;
        expect(inDm).toEqual(onMap);
        expect(inDm).not.toBe(onMap);
    });
});

describe('a name given privately', () => {
    it('is used alone with the person, and not where other people read the greeting', () => {
        const others = { now: [] as string[] };
        const memory = memoryWith(others);
        memory.addMessage(BOT, KHALID, 'My name is Kiko', 'person', DM);

        expect(memory.nameFor(BOT, KHALID)).toBe('Kiko');
        expect(memory.nameFor(BOT, KHALID, 'all')).toBe('Kiko');
        expect(memory.nameFor(BOT, KHALID, { present: [SARA] })).toBeUndefined();
        expect(memory.nameFor(BOT, KHALID, { present: [SOMEONE_UNKNOWN] })).toBeUndefined();
    });

    it('is used in front of the people it was said to', () => {
        const others = { now: [SARA] };
        const memory = memoryWith(others);
        memory.addMessage(BOT, KHALID, 'My name is Kiko', 'person', BUBBLE);

        expect(memory.nameFor(BOT, KHALID, { present: [SARA] })).toBe('Kiko');
        expect(memory.nameFor(BOT, KHALID, { present: [SARA, OMAR] })).toBeUndefined();
    });

    it('keeps a reply only the person read out of what anyone else is told', () => {
        const others = { now: [SARA] };
        const memory = memoryWith(others);
        memory.addMessage(BOT, KHALID, 'When is my interview?', 'person', BUBBLE);
        memory.addPrivateReply(BOT, KHALID, 'It is at 10 on Thursday.', BUBBLE);
        memory.addMessage(BOT, KHALID, "Khalid, I've answered that just for you.", 'bot', BUBBLE);

        const shared = memory.getConversationContext(BOT, KHALID, { present: [SARA] });
        expect(shared).toContain('When is my interview?');
        expect(shared).toContain("I've answered that just for you.");
        expect(shared).not.toContain('at 10 on Thursday');
        expect(memory.getConversationContext(BOT, KHALID)).toContain('It is at 10 on Thursday.');
    });
});

describe('viewFor: who a reply is built for', () => {
    it('is everything alone, the people named in a group, and a stranger when the bot cannot tell', () => {
        expect(viewFor([])).toBe('all');
        expect(viewFor([SARA])).toEqual({ present: [SARA] });
        expect(viewFor(undefined)).toEqual({ present: [SOMEONE_UNKNOWN] });
    });
});

describe('namedOthers: who a file is kept with', () => {
    it('is everyone else who was in the bubble or meeting room, each once', () => {
        expect(namedOthers({ place: 'nearby', with: [SARA, 'uuid-omar', SARA] })).toEqual([SARA, 'uuid-omar']);
        expect(namedOthers({ place: 'nearby', with: [] })).toEqual([]);
    });

    it('is nobody for a direct message, an open place, or when the bot cannot tell', () => {
        expect(namedOthers(heardInDm())).toEqual([]);
        expect(namedOthers({ place: 'open', with: [SARA] })).toEqual([]);
        expect(namedOthers(undefined)).toEqual([]);
    });

    it('leaves out someone the bot cannot name: they can never be told from a stranger later', () => {
        expect(namedOthers({ place: 'nearby', with: [SOMEONE_UNKNOWN, SARA, '', ' ', 'x'] })).toEqual([SARA]);
    });
});
