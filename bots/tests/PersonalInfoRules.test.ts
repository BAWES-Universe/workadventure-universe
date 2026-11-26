import { describe, expect, it } from 'vitest';
import { ConversationMemory } from '../memory/ConversationMemory';
import { birthdayDateIn, birthdayIsToday, nameIn, stateIn, tastesIn, visionNoteOf, withoutContactDetails } from '../memory/PersonalInfoRules';
import { memoryItemsOf } from '../memory/MemoryItems';
import { FORGET_MEMORY_TOOL, runMemoryTool } from '../ai/MemoryTools';
import { vi } from 'vitest';

const BOT = 'bot-1';
const PERSON = 7;

function learnFrom(...lines: string[]): ConversationMemory {
    const memory = new ConversationMemory();
    for (const line of lines) memory.extractPersonalInfo(BOT, PERSON, line, 'dm');
    return memory;
}

describe('nameIn', () => {
    it('takes a name only when they say it is theirs', () => {
        expect(nameIn('My name is Sara')).toBe('Sara');
        expect(nameIn("hi, I'm Sara and I like tea")).toBe('Sara');
        expect(nameIn('Call me Sara.')).toBe('Sara');
        expect(nameIn('I am called Sara')).toBe('Sara');
    });

    it('keeps a name that comes with a surname, an emoji or chat words, or next to something else said with a "not"', () => {
        expect(nameIn('My name is Sara Ahmed')).toBe('Sara');
        expect(nameIn('Call me Sara lol')).toBe('Sara');
        expect(nameIn("I'm Sara \u{1F600}")).toBe('Sara');
        expect(nameIn("I'm Sara Ahmed")).toBe('Sara');
        expect(nameIn("My name is Sara and I don't like coffee")).toBe('Sara');
        expect(nameIn("I don't like coffee, my name is Sara")).toBe('Sara');
        expect(nameIn("I'm not Sara, I'm Noor")).toBe('Noor');
    });

    it('never takes a name from a task or a verb phrase', () => {
        expect(nameIn('Please connect my Google mail')).toBeNull();
        expect(nameIn('can you open my Calendar and read it')).toBeNull();
        expect(nameIn("I'm Sorry about that")).toBeNull();
        expect(nameIn('Call me Monday')).toBeNull();
        expect(nameIn("I'm Not sure about that")).toBeNull();
    });

    it("never takes someone else's name", () => {
        expect(nameIn("My friend's name is Omar")).toBeNull();
        expect(nameIn("The dog's name is Rex")).toBeNull();
        expect(nameIn('What is my name?')).toBeNull();
    });
});

describe('tastesIn', () => {
    it('keeps likes and dislikes apart', () => {
        expect(tastesIn('I like pizza')).toEqual({ likes: ['pizza'], dislikes: [] });
        expect(tastesIn("I don't like coffee")).toEqual({ likes: [], dislikes: ['coffee'] });
        expect(tastesIn('I really hate cold weather.')).toEqual({ likes: [], dislikes: ['cold weather'] });
        expect(tastesIn("I can't stand loud music")).toEqual({ likes: [], dislikes: ['loud music'] });
        expect(tastesIn('my favorite color is green')).toEqual({ likes: ['green (favorite color)'], dislikes: [] });
    });

    it('a remark about the bot is neither a like nor a dislike', () => {
        expect(tastesIn("I don't like how slow you are")).toEqual({ likes: [], dislikes: [] });
        expect(tastesIn('I love how fast you answered')).toEqual({ likes: [], dislikes: [] });
        expect(tastesIn("I don't like that you forgot")).toEqual({ likes: [], dislikes: [] });
        expect(tastesIn('I like you')).toEqual({ likes: [], dislikes: [] });
    });

    it('takes nothing from questions, other people, or contact details', () => {
        expect(tastesIn('Do you like pizza?')).toEqual({ likes: [], dislikes: [] });
        expect(tastesIn('Do I like pizza?')).toEqual({ likes: [], dislikes: [] });
        expect(tastesIn('My sister likes tea')).toEqual({ likes: [], dislikes: [] });
        expect(tastesIn('I love my friend Omar')).toEqual({ likes: [], dislikes: [] });
        expect(tastesIn('I like sara@example.com')).toEqual({ likes: [], dislikes: [] });
    });

    it('a reaction or a polite phrase is not a taste', () => {
        expect(tastesIn('I love it!')).toEqual({ likes: [], dislikes: [] });
        expect(tastesIn('I love it, thanks')).toEqual({ likes: [], dislikes: [] });
        expect(tastesIn('I hate to bother you')).toEqual({ likes: [], dislikes: [] });
        expect(tastesIn("I'd love to help you")).toEqual({ likes: [], dislikes: [] });
        expect(tastesIn('I like to run')).toEqual({ likes: ['to run'], dislikes: [] });
        expect(tastesIn('I like coffee, no sugar')).toEqual({ likes: ['coffee, no sugar'], dislikes: [] });
    });

    it('stops at the end of the thing', () => {
        expect(tastesIn('I like tea, but not on mondays')).toEqual({ likes: ['tea'], dislikes: [] });
        expect(tastesIn("I like tea because it's calming")).toEqual({ likes: ['tea'], dislikes: [] });
    });
});

describe('stateIn', () => {
    it('keeps a state they have and not one they do not', () => {
        expect(stateIn("I'm tired")).toBe('tired');
        expect(stateIn('i feel happy today')).toBe('happy');
        expect(stateIn("I'm not hungry")).toBeNull();
        expect(stateIn('I am never sad')).toBeNull();
        expect(stateIn('Am I tired?')).toBeNull();
        expect(stateIn("I'm sick of waiting")).toBeNull();
    });
});

describe('a "not" is only looked for beside the thing it is about', () => {
    it('keeps a feeling or a birthday said next to something unrelated that has a "not"', () => {
        expect(stateIn("I'm tired but I don't want to stop")).toBe('tired');
        expect(stateIn("I'm not hungry, I'm tired")).toBe('tired');
        expect(stateIn("I'm not tired but I'm hungry")).toBe('hungry');
        expect(stateIn("I'm not tired and not hungry")).toBeNull();
        expect(birthdayIsToday("it's my birthday and I can't wait")).toBe(true);
        expect(birthdayDateIn("My birthday is March 3, don't forget")).toBe('March 3');
        expect(birthdayIsToday("it's not my birthday, it's tomorrow")).toBe(false);
    });
});

describe('birthday', () => {
    it('is theirs, today or on a day', () => {
        expect(birthdayIsToday("it's my birthday")).toBe(true);
        expect(birthdayIsToday('my birthday is today!')).toBe(true);
        expect(birthdayDateIn('My birthday is on March 3')).toBe('March 3');
        expect(birthdayDateIn('my birthday is 3/3')).toBe('3/3');
    });

    it("is never someone else's, or not at all", () => {
        expect(birthdayIsToday("It's Omar's birthday today")).toBe(false);
        expect(birthdayIsToday('Her birthday is today')).toBe(false);
        expect(birthdayIsToday("it's not my birthday")).toBe(false);
        expect(birthdayDateIn("my birthday is in 2 days")).toBeNull();
        expect(birthdayDateIn("my friend's birthday is March 3")).toBeNull();
    });
});

describe('what an image leaves in the history', () => {
    it('takes out e-mail addresses and numbers', () => {
        const text = withoutContactDetails('A card that reads omar.k@example.com, call +965 5555 1234, ref 12345678, 2 cats');
        expect(text).not.toContain('example.com');
        expect(text).not.toContain('5555');
        expect(text).not.toContain('12345678');
        expect(text).toContain('2 cats');
    });

    it('keeps a short summary, never the whole description', () => {
        const long = 'A screenshot of a chat. ' + 'More and more text that the picture shows. '.repeat(40);
        const note = visionNoteOf(long);
        expect(note.length).toBeLessThanOrEqual(301);
        expect(note.startsWith('A screenshot of a chat.')).toBe(true);
        expect(note.endsWith('…')).toBe(true);
    });

    it('is kept short and without contact details in the history', () => {
        const memory = new ConversationMemory();
        memory.addMessage(BOT, PERSON, 'what is this?', 'person', 'dm');
        memory.appendVisionDescription(BOT, PERSON, 'A photo of a note: "Reach Omar at omar.k@example.com or 55551234". ' + 'x '.repeat(500));
        const line = memory.getMemory(BOT, PERSON)!.conversationHistory[0].message;
        expect(line).toContain('[Image description: A photo of a note');
        expect(line).not.toContain('omar.k@example.com');
        expect(line).not.toContain('55551234');
        expect(line.length).toBeLessThan(400);
    });
});

describe('what the bot keeps from a chat', () => {
    it('keeps the real examples right', () => {
        const memory = learnFrom("I don't like how slow you are", 'Please connect my Google mail', 'my friend Omar likes tea');
        const info = memory.getMemory(BOT, PERSON)!.personalInfo;
        expect(info.name).toBeUndefined();
        expect(info.preferences ?? []).toEqual([]);
        expect(memoryItemsOf(memory.getMemory(BOT, PERSON)!)).toEqual([]);
        expect(memory.getConversationContext(BOT, PERSON)).not.toContain('They like');
    });

    it('keeps a dislike as a dislike, and it can be forgotten like the rest', () => {
        const memory = learnFrom("I don't like coffee", 'I like tea');
        const context = memory.getConversationContext(BOT, PERSON);
        expect(context).toContain("They don't like: coffee");
        expect(context).toContain('They like: tea');
        expect(context).not.toContain('They like: coffee');
        const items = memoryItemsOf(memory.getMemory(BOT, PERSON)!);
        expect(items.map((item) => `${item.kind}:${item.label}:${item.value}`).sort()).toEqual(['fact:dislikes:coffee', 'pref:null:tea']);
    });

    it('moves a thing from one list to the other when they change their mind', () => {
        const memory = learnFrom('I like coffee', "I don't like coffee");
        let info = memory.getMemory(BOT, PERSON)!.personalInfo;
        expect(info.preferences).toEqual([]);
        expect(info.facts.get('dislikes')).toBe('coffee');

        memory.extractPersonalInfo(BOT, PERSON, 'I love coffee again', 'dm');
        info = memory.getMemory(BOT, PERSON)!.personalInfo;
        expect(info.preferences).toEqual(['coffee']);
        expect(info.facts.has('dislikes')).toBe(false);
    });

    it('keeps a name only when it is theirs', () => {
        expect(learnFrom('connect my Google mail').getMemory(BOT, PERSON)!.personalInfo.name).toBeUndefined();
        expect(learnFrom('My name is Sara').getMemory(BOT, PERSON)!.personalInfo.name).toBe('Sara');
    });

    it('can be asked to forget a dislike, in words', async () => {
        const memory = learnFrom("I don't like coffee");
        const forget = vi.fn(async () => 1);
        const answer = (await runMemoryTool(FORGET_MEMORY_TOOL, { about: 'coffee' }, { memory: memory.getMemory(BOT, PERSON)!, forget })) as { forgotten: string[] };
        expect(answer.forgotten).toEqual(['They do not like coffee']);
    });
});
