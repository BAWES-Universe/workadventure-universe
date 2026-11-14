/**
 * A voice note's real length, measured on the bot server for free before anything is paid (plan v3, section 3): the clip is decoded
 * with ffmpeg and written out again as one normalized mono Opus file, and the length is what ffmpeg wrote, never the length in the
 * file's header or the number the sender's app sent. That copy is the only thing a hearing provider gets.
 *
 * ffmpeg runs under hard bounds: one thread, a CPU time and memory limit (prlimit, when the system has it), a wall clock, at most the
 * note limit's bytes in, and output stopped one second past the longest note, so a tiny file that unpacks into hours is never decoded
 * past that. A note longer than the limit is refused, never trimmed quietly; audio ffmpeg can't read is refused before any paid step.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type MeasuredNote = { ok: true; seconds: number; bytes: Uint8Array; filename: string } | { ok: false; reason: 'too-long' | 'broken' | 'unavailable' };

export interface NoteLengthOptions {
    /** The longest note, in seconds, when Orbit has not said (5 minutes). */
    maxSeconds: number;
    /** The most bytes read in and written out. */
    maxBytes: number;
    /** How long ffmpeg may run, in milliseconds. */
    timeoutMs?: number;
    /** The most memory ffmpeg may take, in bytes. */
    memoryBytes?: number;
    ffmpegPath?: string;
    prlimitPath?: string | null;
    /** Runs a command with the clip on its input; tests give a fake. */
    run?: (command: string, args: string[], input: Uint8Array, limits: { timeoutMs: number; maxOutputBytes: number }) => Promise<RunResult>;
}

export interface RunResult {
    code: number | null;
    stdout: Uint8Array;
    stderr: string;
    /** The output went past `maxOutputBytes` or the clock ran out: it was stopped. */
    stopped?: 'too-big' | 'timeout';
}

const DEFAULT_TIMEOUT_MS = 20_000;
/** A length may run this far over the longest note before it is refused, as Orbit allows (MEASURE_SLACK_SECONDS). */
export const MEASURE_SLACK_SECONDS = 1;
const DEFAULT_MEMORY_BYTES = 512 * 1024 * 1024;

/**
 * The arguments: read the clip from `input` (a file: a phone's m4a keeps its index at the end, which a pipe can't reach), write mono
 * 16 kHz Opus in Ogg to stdout, with progress lines on stderr.
 */
export function ffmpegArgs(maxSeconds: number, input = 'pipe:0'): string[] {
    return [
        '-hide_banner',
        '-nostdin',
        // Only a file or a pipe, never a network address or another protocol named inside the clip
        '-protocol_whitelist',
        'file,pipe',
        '-loglevel',
        'error',
        '-threads',
        '1',
        '-filter_threads',
        '1',
        '-i',
        input,
        // Never decoded past one second over the limit, however small the file
        '-t',
        String(maxSeconds + MEASURE_SLACK_SECONDS + 1),
        '-map',
        '0:a:0',
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'libopus',
        '-b:a',
        '24k',
        '-f',
        'ogg',
        '-progress',
        'pipe:2',
        '-nostats',
        'pipe:1',
    ];
}

/** The length ffmpeg wrote, from its last progress line ("out_time_us=..."), in seconds. */
export function writtenSeconds(stderr: string): number | null {
    let last: number | null = null;
    for (const match of stderr.matchAll(/^out_time_(?:us|ms)=(\d+)$/gm)) last = Number(match[1]) / 1_000_000;
    return last;
}

export class NoteLength {
    private readonly ffmpeg: string;
    private readonly prlimit: string | null;

    constructor(private readonly options: NoteLengthOptions) {
        this.ffmpeg = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? '/usr/bin/ffmpeg';
        this.prlimit = options.prlimitPath !== undefined ? options.prlimitPath : existsSync('/usr/bin/prlimit') ? '/usr/bin/prlimit' : null;
    }

    /** `longestSeconds`: the longest voice note now (Orbit's Limits, read live), else the one this was made with. */
    async measure(bytes: Uint8Array, longestSeconds?: number): Promise<MeasuredNote> {
        const maxSeconds = longestSeconds ?? this.options.maxSeconds;
        const { maxBytes } = this.options;
        if (bytes.byteLength === 0) return { ok: false, reason: 'broken' };
        if (bytes.byteLength > maxBytes) return { ok: false, reason: 'too-long' };
        const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        // The clip is written to a file of its own, readable by this process only, and removed whatever happens
        let folder: string | undefined;
        let result: RunResult;
        try {
            folder = await mkdtemp(join(tmpdir(), 'note-'));
            const file = join(folder, randomUUID());
            await writeFile(file, bytes, { mode: 0o600 });
            const args = ffmpegArgs(maxSeconds, file);
            const [command, full] = this.prlimit
                ? [this.prlimit, [`--as=${this.options.memoryBytes ?? DEFAULT_MEMORY_BYTES}`, `--cpu=${Math.ceil(timeoutMs / 1000)}`, '--', this.ffmpeg, ...args]]
                : [this.ffmpeg, args];
            result = await (this.options.run ?? runCommand)(command, full, new Uint8Array(), { timeoutMs, maxOutputBytes: maxBytes });
        } catch {
            return { ok: false, reason: 'unavailable' };
        } finally {
            if (folder) await rm(folder, { recursive: true, force: true }).catch(() => undefined);
        }
        if (result.stopped === 'too-big') return { ok: false, reason: 'too-long' };
        if (result.stopped === 'timeout' || result.code !== 0 || result.stdout.byteLength === 0) return { ok: false, reason: 'broken' };
        const seconds = writtenSeconds(result.stderr);
        if (seconds === null || seconds <= 0) return { ok: false, reason: 'broken' };
        // The second ffmpeg may run over is the measurement's, not the person's
        if (seconds > maxSeconds + MEASURE_SLACK_SECONDS) return { ok: false, reason: 'too-long' };
        return { ok: true, seconds: Math.round(seconds * 10) / 10, bytes: result.stdout, filename: 'note.ogg' };
    }
}

/** Runs a command with `input` on stdin; stops it past the clock or past `maxOutputBytes` of output. Throws when it can't start. */
export function runCommand(command: string, args: string[], input: Uint8Array, limits: { timeoutMs: number; maxOutputBytes: number }): Promise<RunResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], env: {} });
        const out: Buffer[] = [];
        let outBytes = 0;
        let err = '';
        let stopped: RunResult['stopped'];
        let started = false;
        const stop = (why: NonNullable<RunResult['stopped']>) => {
            stopped ??= why;
            child.kill('SIGKILL');
        };
        const timer = setTimeout(() => stop('timeout'), limits.timeoutMs);
        child.on('spawn', () => (started = true));
        child.on('error', (error) => {
            clearTimeout(timer);
            if (!started) reject(error);
        });
        child.stdout.on('data', (chunk: Buffer) => {
            outBytes += chunk.byteLength;
            if (outBytes > limits.maxOutputBytes) stop('too-big');
            else out.push(chunk);
        });
        child.stderr.on('data', (chunk: Buffer) => {
            // Only the progress lines are kept, and only so much of them
            if (err.length < 64_000) err += chunk.toString('utf8');
        });
        child.stdin.on('error', () => undefined);
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ code, stdout: new Uint8Array(Buffer.concat(out)), stderr: err, ...(stopped ? { stopped } : {}) });
        });
        child.stdin.end(Buffer.from(input));
    });
}
