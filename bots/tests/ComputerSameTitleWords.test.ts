import { describe, expect, it } from 'vitest';
import { ageOf, whichDated } from '../ai/ComputerControlWords';

/**
 * The FINAL words of 24 Nov (`/mnt/project-files/brick-same-title-and-narrow-stop/strings.txt`): how long ago, and the question that tells jobs of one title apart. The strings are word for
 * word; a title shown twice is told apart by when it ended (or was asked for), and by its order when two would read the same or a time is missing.
 */
const NOW = 1_800_000_000_000;
const ago = (minutes: number): number => NOW - minutes * 60_000;
const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
const plain = (quoted: string[]): string => (quoted.length === 1 ? `Do you mean ${quoted[0]}?` : `Which job do you mean: ${quoted.slice(0, -1).join(', ')} or ${quoted[quoted.length - 1]}?`);
const ended = (jobs: Array<{ title: string; at?: number }>) => whichDated('ended', jobs, NOW, same, plain);
const live = (jobs: Array<{ title: string; at?: number }>) => whichDated('live', jobs, NOW, same, plain);

describe('how long ago, in words', () => {
    it('is never a clock time', () => {
        expect(ageOf(NOW - 20_000, NOW)).toBe('just now');
        expect(ageOf(ago(1), NOW)).toBe('a minute ago');
        expect(ageOf(ago(2), NOW)).toBe('2 minutes ago');
        expect(ageOf(ago(59), NOW)).toBe('59 minutes ago');
        expect(ageOf(ago(60), NOW)).toBe('an hour ago');
        expect(ageOf(ago(119), NOW)).toBe('an hour ago');
        expect(ageOf(ago(120), NOW)).toBe('2 hours ago');
        expect(ageOf(ago(23 * 60 + 59), NOW)).toBe('23 hours ago');
        expect(ageOf(ago(24 * 60), NOW)).toBe('a day ago');
        expect(ageOf(ago(2 * 24 * 60), NOW)).toBe('2 days ago');
        expect(ageOf(ago(29 * 24 * 60 + 60), NOW)).toBe('29 days ago');
        expect(ageOf(ago(30 * 24 * 60), NOW)).toBe('over a month ago');
        expect(ageOf(NOW + 5_000, NOW)).toBe('just now');
    });
});

describe('jobs of one title are told apart', () => {
    it('A, ended, two', () => {
        expect(ended([{ title: 'Visa form', at: ago(25) }, { title: 'Visa form', at: ago(3 * 24 * 60) }])).toBe('Which “Visa form” do you mean: the one that ended 25 minutes ago, or the one that ended 3 days ago?');
    });
    it('A, ended, three: the first says it, the others are bare ages', () => {
        expect(ended([{ title: 'Visa form', at: ago(25) }, { title: 'Visa form', at: ago(120) }, { title: 'Visa form', at: ago(3 * 24 * 60) }])).toBe('Which “Visa form” do you mean: the one that ended 25 minutes ago, 2 hours ago, or 3 days ago?');
    });
    it('A, live, two and three', () => {
        expect(live([{ title: 'Visa form', at: ago(10) }, { title: 'Visa form', at: ago(120) }])).toBe('Which “Visa form” do you mean: the one you asked for 10 minutes ago, or the one you asked for 2 hours ago?');
        expect(live([{ title: 'Visa form', at: ago(10) }, { title: 'Visa form', at: ago(120) }, { title: 'Visa form', at: ago(3 * 24 * 60) }])).toBe('Which “Visa form” do you mean: the one you asked for 10 minutes ago, 2 hours ago, or 3 days ago?');
    });
    it('the one that just ended', () => {
        expect(ended([{ title: 'Visa form', at: NOW - 5_000 }, { title: 'Visa form', at: ago(3 * 24 * 60) }])).toBe('Which “Visa form” do you mean: the one that just ended, or the one that ended 3 days ago?');
    });
    it('B, a mixed list: only a title shown more than once gets its age', () => {
        expect(ended([{ title: 'Visa form', at: ago(25) }, { title: 'Visa form', at: ago(3 * 24 * 60) }, { title: 'Taxi booking', at: ago(5000) }])).toBe('Which job do you mean: “Visa form” (ended 25 minutes ago), “Visa form” (ended 3 days ago) or “Taxi booking”?');
        expect(live([{ title: 'Visa form', at: ago(10) }, { title: 'Visa form', at: ago(120) }, { title: 'Taxi booking', at: ago(300) }])).toBe('Which one do you mean: “Visa form” (asked for 10 minutes ago), “Visa form” (asked for 2 hours ago) or “Taxi booking”?');
    });
    it('C, two that would read the same, or a time that is missing: told apart by order', () => {
        expect(ended([{ title: 'Visa form', at: ago(125) }, { title: 'Visa form', at: ago(150) }])).toBe('Which “Visa form” do you mean: the newer one, or the older one?');
        expect(ended([{ title: 'Visa form', at: ago(25) }, { title: 'Visa form' }])).toBe('Which “Visa form” do you mean: the newer one, or the older one?');
        expect(ended([{ title: 'Visa form', at: ago(125) }, { title: 'Visa form', at: ago(130) }, { title: 'Visa form', at: ago(3 * 24 * 60) }])).toBe('Which “Visa form” do you mean: the newest one, the one before it, or the oldest one?');
        expect(ended([{ title: 'Visa form' }, { title: 'Visa form' }, { title: 'Taxi booking' }])).toBe('Which job do you mean: “Visa form” (newer), “Visa form” (older) or “Taxi booking”?');
    });
    it('no title shown twice: the plain question, unchanged', () => {
        expect(ended([{ title: 'Visa form', at: ago(25) }, { title: 'Taxi booking', at: ago(60) }])).toBe('Which job do you mean: “Visa form” or “Taxi booking”?');
        expect(ended([{ title: 'Visa form', at: ago(25) }])).toBe('Do you mean “Visa form”?');
    });
});
