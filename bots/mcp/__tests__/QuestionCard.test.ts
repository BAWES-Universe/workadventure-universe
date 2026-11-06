import { describe, expect, it } from 'vitest';
import { parseTap } from '../ApprovalCard';
import { ASK_PERSON_TOOL, answerText, askLine, askPersonDefinition, buildQuestion, questionBody, questionEdit, questionNotice, readQuestion } from '../QuestionCard';

const choices = [
    { label: 'Upbeat pop', line: '3 tracks, about 3 minutes each' },
    { label: 'Lo-fi background', line: 'One 20-minute mix to talk over' },
    { label: 'Arabic house' },
];

describe('readQuestion', () => {
    it('makes a card of 2 to 4 equal choices with short lines', () => {
        const read = readQuestion({ question: ' What should the launch party sound like? ', choices, before: 'make the music' });
        expect(read.ok).toBe(true);
        if (!read.ok) return;
        expect(read.asked.question).toBe('What should the launch party sound like?');
        expect(read.asked.choices).toEqual([
            { id: 'c1', label: 'Upbeat pop', line: '3 tracks, about 3 minutes each' },
            { id: 'c2', label: 'Lo-fi background', line: 'One 20-minute mix to talk over' },
            { id: 'c3', label: 'Arabic house' },
        ]);
        expect(read.asked.multiple).toBe(false);
        expect(read.asked.before).toBe('make the music');
    });

    it('turns down fewer than 2 or more than 4 choices, so the bot asks in words', () => {
        expect(readQuestion({ question: 'Which?', choices: [{ label: 'One' }] })).toMatchObject({ ok: false });
        expect(readQuestion({ question: 'Which?', choices: ['a', 'b', 'c', 'd', 'e'].map((label) => ({ label })) })).toMatchObject({ ok: false });
        expect(readQuestion({ question: 'Which?' })).toMatchObject({ ok: false });
    });

    it('needs a question, a name for every choice, and different names', () => {
        expect(readQuestion({ question: '  ', choices })).toMatchObject({ ok: false });
        expect(readQuestion({ question: 'Which?', choices: [{ label: 'A' }, { label: '' }] })).toMatchObject({ ok: false });
        expect(readQuestion({ question: 'Which?', choices: [{ label: 'Pop' }, { label: 'pop' }] })).toMatchObject({ ok: false });
    });

    it('accepts plain strings as choices and keeps long words short', () => {
        const read = readQuestion({ question: 'Which?', choices: ['Pop', { label: 'x'.repeat(200), line: 'y'.repeat(300) }] });
        expect(read.ok).toBe(true);
        if (!read.ok) return;
        expect(read.asked.choices[0]).toEqual({ id: 'c1', label: 'Pop' });
        expect(read.asked.choices[1].label.length).toBeLessThanOrEqual(60);
        expect(read.asked.choices[1].line!.length).toBeLessThanOrEqual(100);
    });

    it('keeps "multiple" only when it is exactly true', () => {
        expect(readQuestion({ question: 'Which?', choices, multiple: true })).toMatchObject({ ok: true, asked: { multiple: true } });
        expect(readQuestion({ question: 'Which?', choices, multiple: 'yes' })).toMatchObject({ ok: true, asked: { multiple: false } });
    });

    it('drops a "before" that could carry something from the card: a link, an address, a number or markup', () => {
        for (const before of ['see https://x.example', 'email me@x.co', 'make 3 tracks', 'make <b>it</b>']) {
            const read = readQuestion({ question: 'Which?', choices, before });
            expect(read).toMatchObject({ ok: true });
            if (read.ok) expect(read.asked.before).toBeUndefined();
        }
    });
});

describe('the card', () => {
    const asked = { question: 'What should the launch party sound like?', choices: [{ id: 'c1', label: 'Upbeat pop', line: '3 tracks' }, { id: 'c2', label: 'Lo-fi' }], multiple: false };
    const facts = { ...asked, id: 'q1', revision: 1, expiresAt: 2_000_000, waitMinutes: 10 };

    it('carries the question, the choices and the clock the game counts from', () => {
        expect(buildQuestion(facts, 1_000_000)).toEqual({
            v: 1,
            kind: 'question',
            id: 'q1',
            revision: 1,
            title: asked.question,
            choices: asked.choices,
            expiresAt: 2_000_000,
            now: 1_000_000,
            waitMinutes: 10,
        });
        expect(buildQuestion({ ...facts, multiple: true }, 1)).toMatchObject({ multiple: true });
    });

    it('says the same in plain words for chat apps that cannot draw it', () => {
        expect(questionBody(buildQuestion(facts, 1))).toBe('What should the launch party sound like?\n- Upbeat pop: 3 tracks\n- Lo-fi\nTap a choice, or type your own answer.');
    });

    it('says how it ended', () => {
        const ended = (answer: object) => questionBody(buildQuestion(facts, 1, answer));
        expect(ended({ picked: ['c1'] })).toContain('You picked Upbeat pop.');
        expect(ended({ picked: ['c1', 'c2'] })).toContain('You picked Upbeat pop and Lo-fi.');
        expect(ended({ typed: true })).toContain('You answered by typing.');
        expect(ended({ spoken: true })).toContain('You answered out loud.');
        expect(ended({ closed: true })).toContain('You closed this card, so nothing was done.');
        expect(ended({ expired: true })).toContain('No answer in time, so nothing was done.');
    });

    it('is a notice that carries the field, and an edit that replaces the same notice', () => {
        const field = buildQuestion(facts, 1);
        expect(questionNotice(field)).toMatchObject({ msgtype: 'm.notice', 'universe.ask': field });
        const edit = questionEdit('$e1', buildQuestion({ ...facts, revision: 2 }, 1, { typed: true })) as Record<string, any>;
        expect(edit['m.relates_to']).toEqual({ rel_type: 'm.replace', event_id: '$e1' });
        expect(edit['m.new_content']['universe.ask'].revision).toBe(2);
        expect(edit.body.startsWith('* ')).toBe(true);
    });
});

describe('what the bot goes on with', () => {
    const field = { title: 'What should the launch party sound like?', choices: [{ id: 'c1', label: 'Upbeat pop', line: '3 tracks' }, { id: 'c2', label: 'Lo-fi' }] };
    it('is the pick as the person would say it, with the short line of each choice', () => {
        expect(answerText(field, ['c1'])).toBe('My answer to your question "What should the launch party sound like?": Upbeat pop (3 tracks). Go ahead with that.');
        expect(answerText(field, ['c1', 'c2'])).toContain('Upbeat pop (3 tracks) and Lo-fi.');
    });
});

describe('the line everyone nearby reads', () => {
    it('is made of the name and what the bot said it will do, and nothing from the card', () => {
        expect(askLine('Khalid', 'make the music')).toBe('Khalid, I need your pick before I make the music.');
        expect(askLine('Khalid')).toBe('Khalid, I need your pick before I go on.');
        expect(askLine(null, 'make the music')).toBe('I need your pick before I make the music.');
    });
});

describe('a tap', () => {
    const tap = (more: object) => parseTap({ v: 1, ask: 'q1', revision: 1, ...more });
    it('names the ids of the choices, never their words', () => {
        expect(tap({ action: 'pick', choices: ['c1'] })).toEqual({ ask: 'q1', revision: 1, tap: { action: 'pick', choices: ['c1'] } });
        expect(tap({ action: 'pick', choices: ['c2', 'c1'] })).toMatchObject({ tap: { choices: ['c2', 'c1'] } });
    });
    it('is not a pick when it holds words, repeats a choice, holds none or too many', () => {
        expect(tap({ action: 'pick', choices: ['Upbeat pop'] })).toBeNull();
        expect(tap({ action: 'pick', choices: ['c1', 'c1'] })).toBeNull();
        expect(tap({ action: 'pick', choices: [] })).toBeNull();
        expect(tap({ action: 'pick', choices: ['c1', 'c2', 'c3', 'c4', 'c1'] })).toBeNull();
        expect(tap({ action: 'pick' })).toBeNull();
    });
});

describe('the tool the model sees', () => {
    it('is named ask_person and needs a question and choices', () => {
        const rarely = askPersonDefinition('rarely');
        expect(rarely.function.name).toBe(ASK_PERSON_TOOL);
        expect(rarely.function.parameters.required).toEqual(['question', 'choices']);
        expect(rarely.function.description).toContain('rarely');
    });
    it('is told to use it before any bigger job when the setting says so', () => {
        expect(askPersonDefinition('beforeBiggerJobs').function.description).toContain('before a bigger job');
        expect(askPersonDefinition('beforeBiggerJobs').function.description).not.toContain('all three hold');
    });
});
