import { describe, expect, it } from 'vitest';
import { createRefusalNotes, REFUSAL_NOTE_KEEP_MS } from '../server/ComputerRefusals';

describe('what the relay refused for a person’s allowance or rules', () => {
    it('answers for a job only from the moment asked, and for no other job', () => {
        let at = 1000;
        const notes = createRefusalNotes(() => at);
        expect(notes.sawSince('a', 0)).toBe(false);
        notes.note('a');
        expect(notes.sawSince('a', 1000)).toBe(true);
        expect(notes.sawSince('a', 1001)).toBe(false);
        expect(notes.sawSince('b', 0)).toBe(false);
        at = 5000;
        notes.note('a');
        expect(notes.sawSince('a', 5000)).toBe(true);
    });

    it('forgets a note after a while, so the notes of finished jobs do not pile up', () => {
        let at = 0;
        const notes = createRefusalNotes(() => at);
        notes.note('old');
        at = REFUSAL_NOTE_KEEP_MS + 1;
        notes.note('new');
        expect(notes.sawSince('old', 0)).toBe(false);
        expect(notes.sawSince('new', 0)).toBe(true);
    });
});
