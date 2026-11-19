// Checks of the guards of the evaluation tools: they refuse bad input before they change anything, and a failed run leaves
// nothing that says it finished. Nothing here needs the model or the data set.
//   npm test
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readWav16k } from '../src/wav.ts';
import { SileroStream, type SileroModel } from '../src/silero.ts';
import { sourceSha, SYNTHETIC } from '../src/sources.ts';

const root = new URL('..', import.meta.url).pathname;
const scratch = (): string => mkdtempSync(join(tmpdir(), 'vad-eval-'));
const tsx = (args: string[], cwd = root) => spawnSync(process.execPath, ['--import', 'tsx', ...args], { cwd, encoding: 'utf8' });

function wav(path: string, samples: number, declared = samples * 2): void {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(36 + declared, 4);
    header.write('WAVE', 8, 'ascii');
    header.write('fmt ', 12, 'ascii');
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(16000, 24);
    header.writeUInt32LE(32000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36, 'ascii');
    header.writeUInt32LE(declared, 40);
    writeFileSync(path, Buffer.concat([header, Buffer.alloc(samples * 2, 1)]));
}

describe('reading a WAV', () => {
    it('reads a whole one, and refuses a file cut short or cut in a sample', () => {
        const dir = scratch();
        wav(join(dir, 'ok.wav'), 100);
        assert.equal(readWav16k(join(dir, 'ok.wav')).length, 100);
        // The header declares 200 bytes and only 100 are there
        wav(join(dir, 'short.wav'), 50, 200);
        assert.throws(() => readWav16k(join(dir, 'short.wav')), /truncated/);
        wav(join(dir, 'odd.wav'), 50, 99);
        assert.throws(() => readWav16k(join(dir, 'odd.wav')), /part of a sample/);
    });
});

describe('the source hash', () => {
    it('is the hash of the file, and "synthetic" for a clip with no recording', () => {
        const dir = scratch();
        wav(join(dir, 'a.wav'), 10);
        const before = sourceSha(dir, 'a.wav');
        assert.match(before, /^[0-9a-f]{16}$/);
        assert.equal(sourceSha(dir, 'a.wav'), before);
        wav(join(dir, 'a.wav'), 11);
        assert.notEqual(sourceSha(dir, 'a.wav'), before);
        assert.equal(sourceSha(dir, 'synthetic/burst/1/2'), SYNTHETIC);
    });
});

describe('the shard count', () => {
    it('is checked before any result is deleted', () => {
        const out = scratch();
        writeFileSync(join(out, 'raw-0.jsonl'), 'kept\n');
        for (const bad of ['0', 'abc', '-2', '1.5']) {
            const run = tsx(['src/run-all.ts', scratch(), out, bad]);
            assert.notEqual(run.status, 0, `shards "${bad}" must fail`);
            assert.equal(readFileSync(join(out, 'raw-0.jsonl'), 'utf8'), 'kept\n');
        }
    });
});

describe('an evaluation that cannot run', () => {
    it('refuses a runtime that is neither native nor wasm, before it loads the model', () => {
        const out = scratch();
        const run = tsx(['src/evaluate.ts', scratch(), out, '0', '1', 'natve']);
        assert.notEqual(run.status, 0);
        assert.match(run.stderr, /runtime must be "native" or "wasm"/);
    });

    it('does not leave the marker of an earlier run saying that the shard finished', () => {
        const out = scratch();
        writeFileSync(join(out, 'done-0.json'), '{"shard":0}');
        // No model in the data folder: it fails when it loads it
        const run = tsx(['src/evaluate.ts', scratch(), out, '0', '1', 'native']);
        assert.notEqual(run.status, 0);
        assert.equal(existsSync(join(out, 'done-0.json')), false);
    });
});

describe('a stream that is reset while it is working', () => {
    it('starts again from nothing: the inference still on its way does not write the old state back', async () => {
        const seen: number[][] = [];
        let release: () => void = () => undefined;
        let calls = 0;
        const model = {
            infer: (_input: Float32Array, state: Float32Array) => {
                seen.push([...state]);
                calls++;
                const filled = new Float32Array(state.length).fill(1);
                if (calls > 1) return Promise.resolve({ prob: 0, state: filled });
                return new Promise((resolve) => {
                    release = () => resolve({ prob: 0, state: filled });
                });
            },
        } as unknown as SileroModel;
        const stream = new SileroStream(model);
        const first = stream.push(new Int16Array(512));
        stream.reset();
        const second = stream.push(new Int16Array(512));
        // The first inference has started (it is the one being held) before it is let go
        await new Promise((resolve) => setImmediate(resolve));
        release();
        await Promise.all([first, second]);
        assert.equal(seen.length, 2);
        // What the second window was given: nothing of the first one's answer
        assert.ok(seen[1].every((x) => x === 0));
    });
});

describe('worker-load.sh', () => {
    function stubs(connected: string): { dir: string; env: NodeJS.ProcessEnv; calls: string } {
        const dir = scratch();
        const bin = join(dir, 'bin');
        mkdirSync(bin);
        const calls = join(dir, 'calls.log');
        const stub = (name: string, body: string) => {
            writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${calls}"\n${body}\n`);
            chmodSync(join(bin, name), 0o755);
        };
        stub('docker', 'case "$1" in inspect) echo "stub";; esac; exit 0');
        stub('curl', 'exit 0');
        // The load generator: says how many people connected, then waits to be stopped
        stub('node', `echo "${connected}" >&2; sleep 30 & wait`);
        return { dir, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNS: 'lane:5:on' }, calls };
    }
    const sh = (script: string, args: string[], env: NodeJS.ProcessEnv, cwd: string) => spawnSync('sh', [join(root, 'scripts', script), ...args], { env, cwd, encoding: 'utf8', timeout: 60000 });

    it('refuses seconds per run that would make the measured stretch negative, before it starts anything', () => {
        const { dir, env, calls } = stubs('5 of 5 people connected');
        const run = sh('worker-load.sh', [join(dir, 'data'), join(dir, 'out'), '10'], env, dir);
        assert.equal(run.status, 2);
        assert.equal(existsSync(calls), false);
    });

    it('stops with the reason kept when not everyone connected, and goes on to measure when everyone did', () => {
        const bad = stubs('0 of 5 people connected');
        mkdirSync(join(bad.dir, 'data'));
        const failed = sh('worker-load.sh', [join(bad.dir, 'data'), join(bad.dir, 'out'), '30'], bad.env, bad.dir);
        assert.equal(failed.status, 1);
        assert.match(readFileSync(join(bad.dir, 'out', 'on-5.INVALID.txt'), 'utf8'), /not all 5 people connected/);
        assert.doesNotMatch(readFileSync(bad.calls, 'utf8'), /kill -s USR2/);
    });
});
