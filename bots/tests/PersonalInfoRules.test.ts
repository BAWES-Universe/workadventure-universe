import { describe, expect, it } from 'vitest';
import { ConversationMemory } from '../memory/ConversationMemory';
import { birthdayDateIn, birthdayIsToday, dislikeLabel, nameIn, stateIn, tastesIn, visionNoteOf, withoutContactDetails } from '../memory/PersonalInfoRules';
import { dropItems, memoryItemsOf } from '../memory/MemoryItems';
import { FORGET_MEMORY_TOOL, runMemoryTool } from '../ai/MemoryTools';
import { vi } from 'vitest';
import { heardInDm } from '../memory/Heard';

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

    it('never takes a name from words they quote or ask to have written', () => {
        expect(nameIn('Please translate "my name is Sara" into French')).toBeNull();
        expect(nameIn('Translate my name is Sara into French')).toBeNull();
        expect(nameIn('Write a sentence that says I am Sara')).toBeNull();
        expect(nameIn('Say "I\'m Sara" in Spanish')).toBeNull();
        expect(nameIn('My name is Sara. Please translate "hello" into French')).toBe('Sara');
        expect(nameIn('Please translate "hello" into French. My name is Sara')).toBe('Sara');
    });

    it('never takes a name from a verb phrase', () => {
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

    it('takes each thing they say on its own when two are joined with "and"', () => {
        expect(tastesIn('I like tea and I hate coffee')).toEqual({ likes: ['tea'], dislikes: ['coffee'] });
        expect(tastesIn('I love pizza and my sister hates it')).toEqual({ likes: ['pizza'], dislikes: [] });
        expect(tastesIn("I like tea but I don't like coffee")).toEqual({ likes: ['tea'], dislikes: ['coffee'] });
        expect(tastesIn('I like tea and coffee')).toEqual({ likes: ['tea and coffee'], dislikes: [] });
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
        expect(birthdayDateIn('My birthday is March 3rd')).toBe('March 3');
        expect(birthdayDateIn('my birthday is on April 1st!')).toBe('April 1');
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

describe('where an image summary goes', () => {
    it('is put on the line said in the same space, never on one said elsewhere while the picture was read', () => {
        const memory = new ConversationMemory();
        memory.addMessage(BOT, PERSON, 'look at this', 'person', 'dm');
        memory.addMessage(BOT, PERSON, 'hi all', 'person', 'bubble');
        memory.appendVisionDescription(BOT, PERSON, 'A bank statement', 'dm');
        const [dm, bubble] = memory.getMemory(BOT, PERSON)!.conversationHistory;
        expect(dm.message).toContain('[Image description: A bank statement]');
        expect(bubble.message).toBe('hi all');
    });

    it('is dropped when the space has no line of theirs', () => {
        const memory = new ConversationMemory();
        memory.addMessage(BOT, PERSON, 'hi all', 'person', 'bubble');
        memory.appendVisionDescription(BOT, PERSON, 'A bank statement', 'dm');
        expect(memory.getMemory(BOT, PERSON)!.conversationHistory[0].message).toBe('hi all');
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
        expect(items.map((item) => `${item.kind}:${item.label}:${item.value}`).sort()).toEqual([`fact:${dislikeLabel('coffee')}:coffee`, 'pref:null:tea']);
    });

    it('moves a thing from one list to the other when they change their mind', () => {
        const memory = learnFrom('I like coffee', "I don't like coffee");
        let info = memory.getMemory(BOT, PERSON)!.personalInfo;
        expect(info.preferences).toEqual([]);
        expect(info.facts.get(dislikeLabel('coffee'))).toBe('coffee');

        memory.extractPersonalInfo(BOT, PERSON, 'I love coffee again', 'dm');
        info = memory.getMemory(BOT, PERSON)!.personalInfo;
        expect(info.preferences).toEqual(['coffee']);
        expect([...info.facts.keys()].some((key) => key.startsWith('dislike_'))).toBe(false);
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

    it('keeps who heard each dislike: one said in a private talk stays out of a reply others read', () => {
        const others = { now: [] as string[] };
        const memory = new ConversationMemory();
        memory.useHeard((_bot, _player, space) => (space === 'dm' ? heardInDm() : { place: 'nearby', with: [...others.now] }));
        memory.extractPersonalInfo(BOT, PERSON, "I don't like coffee", 'dm');
        others.now = ['uuid-sara'];
        memory.extractPersonalInfo(BOT, PERSON, "I don't like tea", 'bubble');

        const shared = memory.getConversationContext(BOT, PERSON, { present: ['uuid-sara'] });
        expect(shared).toContain("They don't like: tea");
        expect(shared).not.toContain('coffee');
        expect(memory.getConversationContext(BOT, PERSON)).toContain("They don't like: coffee, tea");
    });

    it('keeps the latest ten dislikes', () => {
        const memory = learnFrom(...Array.from({ length: 12 }, (_, index) => `I hate thing${String.fromCharCode(97 + index)}`));
        const info = memory.getMemory(BOT, PERSON)!.personalInfo;
        const kept = [...info.facts.values()];
        expect(kept).toHaveLength(10);
        expect(kept).not.toContain('thinga');
        expect(kept).toContain('thingl');
        expect(Object.keys(info.drawnFrom ?? {}).filter((key) => key.startsWith('fact:dislike_'))).toHaveLength(10);
    });

    it('forgetting a dislike takes every line that says it, as a like does', () => {
        const memory = new ConversationMemory();
        const say = (text: string, at: number) => {
            memory.addMessage(BOT, PERSON, text, 'person', 'dm', false);
            memory.getMemory(BOT, PERSON)!.conversationHistory.at(-1)!.timestamp = at;
            memory.extractPersonalInfo(BOT, PERSON, text, 'dm', at);
        };
        say("I don't like coffee", 1000);
        say('I like walking', 2000);
        say("honestly I don't like coffee", 3000);
        const target = memoryItemsOf(memory.getMemory(BOT, PERSON)!).find((item) => item.value === 'coffee')!;
        expect(dropItems(memory.getMemory(BOT, PERSON)!, new Set([target.id]))).toBe(1);
        const lines = memory.getMemory(BOT, PERSON)!.conversationHistory.map((line) => line.message);
        expect(lines).toEqual(['I like walking']);
    });

    it('stamps a like said again with other capitals under the spelling that is kept', () => {
        const memory = learnFrom('I like Jazz', 'I like jazz');
        const info = memory.getMemory(BOT, PERSON)!.personalInfo;
        expect(info.preferences).toEqual(['Jazz']);
        expect(Object.keys(info.drawnFrom ?? {}).filter((key) => key.startsWith('pref:'))).toEqual(['pref:Jazz']);
    });
    it('keeps "C++" and "C#" as two dislikes, each forgotten alone', () => {
        expect(dislikeLabel('C++')).not.toBe(dislikeLabel('C#'));
        expect(dislikeLabel('Coffee')).toBe(dislikeLabel('coffee'));
        const memory = learnFrom('I hate C++', 'I hate C#');
        const stored = memory.getMemory(BOT, PERSON)!;
        expect([...stored.personalInfo.facts.values()].sort()).toEqual(['C#', 'C++']);
        const target = memoryItemsOf(stored).find((item) => item.value === 'C++')!;
        expect(dropItems(stored, new Set([target.id]))).toBe(1);
        expect([...stored.personalInfo.facts.values()]).toEqual(['C#']);
    });

    it('counts a dislike said again as the latest, so it is not the first to go past ten', () => {
        const lines = Array.from({ length: 10 }, (_, index) => `I hate thing${String.fromCharCode(97 + index)}`);
        const memory = learnFrom(...lines, 'I hate thinga', 'I hate thingk');
        const kept = [...memory.getMemory(BOT, PERSON)!.personalInfo.facts.values()];
        expect(kept).toHaveLength(10);
        expect(kept).toContain('thinga');
        expect(kept).not.toContain('thingb');
        expect(kept).toContain('thingk');
    });

    it('forgetting a short dislike takes the earlier lines that said it and the reply that says it back, and nothing else', () => {
        const memory = new ConversationMemory();
        const say = (text: string, at: number, sender: 'person' | 'bot' = 'person') => {
            memory.addMessage(BOT, PERSON, text, sender, 'dm', false);
            memory.getMemory(BOT, PERSON)!.conversationHistory.at(-1)!.timestamp = at;
            if (sender === 'person') memory.extractPersonalInfo(BOT, PERSON, text, 'dm', at);
        };
        say('I hate tea', 1000);
        say('I like steam rooms', 2000);
        say('You hate tea, noted.', 2500, 'bot');
        say('ok, I hate tea so much', 3000);
        say('Steam rooms are great', 3500, 'bot');
        const stored = memory.getMemory(BOT, PERSON)!;
        const target = memoryItemsOf(stored).find((item) => item.value === 'tea')!;
        expect(dropItems(stored, new Set([target.id]))).toBe(1);
        expect(stored.conversationHistory.map((line) => line.message)).toEqual(['I like steam rooms', 'Steam rooms are great']);
    });
});
