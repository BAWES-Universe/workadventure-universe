/**
 * A voice note's real length, measured with ffmpeg before anything is paid (plan v3, section 3). The real ffmpeg runs when the
 * machine has it (the bots image always does); the bounds are shown with a stand-in.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NoteLength, ffmpegArgs, writtenSeconds, type RunResult } from '../voice/NoteLength';

const FFMPEG = '/usr/bin/ffmpeg';
const real = existsSync(FFMPEG) ? describe : describe.skip;

/** A tone of `seconds`, made by ffmpeg itself, in a container a phone records in. */
const tone = (seconds: number, codec: 'libopus' | 'aac', format: 'ogg' | 'ipod') => {
    const folder = mkdtempSync(join(tmpdir(), 'tone-'));
    const file = join(folder, `tone.${format === 'ipod' ? 'm4a' : 'ogg'}`);
    try {
        execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-c:a', codec, '-f', format, file]);
        return new Uint8Array(readFileSync(file));
    } finally {
        rmSync(folder, { recursive: true, force: true });
    }
};

real('with the real ffmpeg', () => {
    const length = new NoteLength({ maxSeconds: 5, maxBytes: 15 * 1024 * 1024 });

    it('measures a note from its audio and writes one mono Opus file for the provider', async () => {
        const measured = await length.measure(tone(3, 'libopus', 'ogg'));
        expect(measured).toMatchObject({ ok: true, filename: 'note.ogg' });
        if (!measured.ok) return;
        expect(measured.seconds).toBeGreaterThan(2.8);
        expect(measured.seconds).toBeLessThan(3.2);
        expect(Buffer.from(measured.bytes.slice(0, 4)).toString('latin1')).toBe('OggS');
    });

    it('reads a phone\'s m4a too, whose index is at the end of the file', async () => {
        expect(await length.measure(tone(2, 'aac', 'ipod'))).toMatchObject({ ok: true });
    });

    it('refuses a note over the longest one, and reads the longest one it is given', async () => {
        expect(await length.measure(tone(8, 'libopus', 'ogg'))).toEqual({ ok: false, reason: 'too-long' });
        expect(await length.measure(tone(8, 'libopus', 'ogg'), 10)).toMatchObject({ ok: true });
        expect(await length.measure(tone(4, 'libopus', 'ogg'), 2)).toEqual({ ok: false, reason: 'too-long' });
    });

    it('refuses audio it can\'t read, before anything is paid', async () => {
        expect(await length.measure(new TextEncoder().encode('this is not audio at all'))).toEqual({ ok: false, reason: 'broken' });
        expect(await length.measure(new Uint8Array())).toEqual({ ok: false, reason: 'broken' });
    });

    it('never trusts the header: a file that says it is short but holds more is measured by what it holds', async () => {
        // A long note cut into a container whose header was written for a short one is still decoded to the end, up to the limit
        const long = tone(9, 'libopus', 'ogg');
        expect(await length.measure(long)).toEqual({ ok: false, reason: 'too-long' });
    });
});

describe('the bounds', () => {
    const fake = (result: Partial<RunResult>) => async () => ({ code: 0, stdout: new Uint8Array([1]), stderr: 'out_time_us=3000000\nprogress=end\n', ...result });

    it('stops decoding one second past the longest note plus the measurement\'s slack, on one thread', () => {
        const args = ffmpegArgs(300);
        expect(args[args.indexOf('-t') + 1]).toBe('302');
        expect(args[args.indexOf('-threads') + 1]).toBe('1');
        expect(args).toContain('libopus');
    });

    it('reads the length ffmpeg wrote from its last progress line', () => {
        expect(writtenSeconds('out_time_us=1000000\nout_time_us=4500000\nprogress=end\n')).toBe(4.5);
        expect(writtenSeconds('nothing')).toBeNull();
    });

    it('runs ffmpeg under prlimit with a memory and CPU limit when the system has it', async () => {
        let seen: string[] = [];
        const length = new NoteLength({
            maxSeconds: 300,
            maxBytes: 1000,
            prlimitPath: '/usr/bin/prlimit',
            ffmpegPath: '/usr/bin/ffmpeg',
            run: async (command, args) => {
                seen = [command, ...args];
                return fake({})();
            },
        });
        await length.measure(new Uint8Array([1, 2, 3]));
        expect(seen.slice(0, 5)).toEqual(['/usr/bin/prlimit', '--as=536870912', '--cpu=20', '--', '/usr/bin/ffmpeg']);
    });

    it('refuses a file over the size limit unread, output past it, a run past the clock, and a missing ffmpeg', async () => {
        const make = (run: NonNullable<ConstructorParameters<typeof NoteLength>[0]['run']>) => new NoteLength({ maxSeconds: 300, maxBytes: 10, prlimitPath: null, run });
        expect(await make(fake({})).measure(new Uint8Array(11))).toEqual({ ok: false, reason: 'too-long' });
        expect(await make(fake({ stopped: 'too-big' })).measure(new Uint8Array(5))).toEqual({ ok: false, reason: 'too-long' });
        expect(await make(fake({ stopped: 'timeout', code: null })).measure(new Uint8Array(5))).toEqual({ ok: false, reason: 'broken' });
        expect(
            await make(async () => {
                throw new Error('ENOENT');
            }).measure(new Uint8Array(5))
        ).toEqual({ ok: false, reason: 'unavailable' });
        expect(await make(fake({ stderr: 'out_time_us=301500000\n' })).measure(new Uint8Array(5))).toEqual({ ok: false, reason: 'too-long' });
        expect(await make(fake({ stderr: 'out_time_us=300900000\n' })).measure(new Uint8Array(5))).toMatchObject({ ok: true, seconds: 300.9 });
    });
});
