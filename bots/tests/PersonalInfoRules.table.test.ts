import { describe, expect, it } from 'vitest';
import { birthdayDateIn, birthdayIsToday, nameIn, stateIn, tastesIn } from '../memory/PersonalInfoRules';

type Said = { name: string | null; likes: string[]; dislikes: string[]; state: string | null; birthday: string | null; today: boolean };
const none: Said = { name: null, likes: [], dislikes: [], state: null, birthday: null, today: false };
const read = (message: string): Said => {
    const { likes, dislikes } = tastesIn(message);
    return { name: nameIn(message), likes, dislikes, state: stateIn(message), birthday: birthdayDateIn(message), today: birthdayIsToday(message) };
};

// Ordinary things people say to a Brick, and what may be kept of each (nothing, unless it is theirs and not negated)
const TABLE: Array<[string, Partial<Said>]> = [
    // ordinals and dates in several forms
    ['My birthday is March 3rd', { birthday: 'March 3' }],
    ["my birthday's on April 1st", { birthday: 'April 1' }],
    ['My birthday is on May 2nd.', { birthday: 'May 2' }],
    ['my birthday is November 11th and I love cake', { birthday: 'November 11', likes: ['cake'] }],
    ['My birthday is the 3rd of March', {}],
    ['My birthday is on the 15th of May', {}],
    ['my birthday is 15/5', { birthday: '15/5' }],
    ['My birthday is 3-3.', { birthday: '3-3' }],
    ['my bday is june 21', { birthday: 'june 21' }],
    ['My birthday was December 25th, remember it', { birthday: 'December 25' }],
    ["Omar's birthday is March 3rd", {}],
    ['my sister birthday is May 15th', {}],
    ['It is my birthday today!', { today: true }],
    ["today is Sara's birthday", {}],
    // "and" clauses and someone else's opinion
    ['I like tea and I hate coffee', { likes: ['tea'], dislikes: ['coffee'] }],
    ['I love pizza and my sister hates it', { likes: ['pizza'] }],
    ['I love pizza and my sister loves pasta', { likes: ['pizza'] }],
    ["I like tea but I don't like coffee", { likes: ['tea'], dislikes: ['coffee'] }],
    ['I like tea and coffee', { likes: ['tea and coffee'] }],
    ['My brother likes tea and I like coffee', { likes: ['coffee'] }],
    ['I like cats and my dog likes me', { likes: ['cats'] }],
    ['Omar loves football and I love chess', { likes: ['chess'] }],
    // negations and remarks
    ["I don't like waiting", { dislikes: ['waiting'] }],
    ["I really don't like spicy food.", { dislikes: ['spicy food'] }],
    ["I never liked coffee", {}],
    ['I do not like it when you repeat yourself', {}],
    ['I love how you explained that', {}],
    ["I like what you did there", {}],
    ["I'm not tired", {}],
    ["I'm not tired, I'm bored", { state: 'bored' }],
    ['I was tired yesterday', {}],
    // names
    ['My name is Sara Ahmed', { name: 'Sara' }],
    ['call me Sara', { name: 'Sara' }],
    ["I'm Sara 😊", { name: 'Sara' }],
    ["Hi, I'm Noor, nice to meet you", { name: 'Noor' }],
    ["I'm Sorry to bother you", {}],
    ['Connect my Gmail please', {}],
    ["I'm Hungry", { state: 'hungry' }],
    ["My name is Sara and I don't like coffee", { name: 'Sara', dislikes: ['coffee'] }],
    ['Can you call me Monday?', {}],
    ["What's my name?", {}],
    ["I'm a developer", {}],
    ["I'm Muhammad.", { name: 'Muhammad' }],
    ['My name is not important', {}],
    ['I am so happy', {}],
    ['I feel sick of it', {}],
    ["I'm happy and I love my job", { state: 'happy' }],
    ["I'm happy, I'm not sad", { state: 'happy' }],
    ['Do you like jazz? I like jazz.', { likes: ['jazz'] }],
    ['I like jazz?', {}],
    ['I love my job', {}],
    ["I can't stand him", {}],
    ['I like it here', {}],
    ['I hate when people lie', {}],
    ['my email is sara@example.com and I like tea', { likes: ['tea'] }],
    ['I like sara@example.com', {}],
    ['I love 555-123-4567', {}],
    // filler and reactions
    ['I love it!!', {}],
    ['I like that', {}],
    ['I love you', {}],
    ['I like to move it move it', { likes: ['to move it move it'] }],
    ['thanks, I appreciate it', {}],
    ['I like the blue one, thanks', { likes: ['the blue one'] }],
    ['I prefer tea lol', { likes: ['tea'] }],
    ['i like pizza', { likes: ['pizza'] }],
    ['I like pizza.\nI hate olives.', { likes: ['pizza'], dislikes: ['olives'] }],
    ['I hate Mondays, but I love Fridays', { likes: ['Fridays'], dislikes: ['Mondays'] }],
];

describe('ordinary sentences, one table', () => {
    for (const [message, expected] of TABLE) {
        it(JSON.stringify(message), () => {
            expect(read(message)).toEqual({ ...none, ...expected });
        });
    }
});
