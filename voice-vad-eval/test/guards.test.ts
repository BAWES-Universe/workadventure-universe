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
        // (it ends when the measured stretch is ended, with SIGUSR1, as the real one does; SIGUSR2 starts the stretch and changes nothing)
        stub('node', `trap : USR2; trap 'exit 0' USR1; echo "${connected}" >&2; sleep 30 >/dev/null 2>&1 & while kill -0 $! 2>/dev/null; do wait $!; done`);
        return { dir, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNS: 'lane:5:on' }, calls };
    }
    const sh = (script: string, args: string[], env: NodeJS.ProcessEnv, cwd: string) => spawnSync('sh', [join(root, 'scripts', script), ...args], { env, cwd, encoding: 'utf8', timeout: 60000 });

    it('refuses seconds per run that would make the measured stretch negative, before it starts anything', () => {
        const { dir, env, calls } = stubs('5 of 5 people connected');
        const run = sh('worker-load.sh', [join(dir, 'data'), join(dir, 'out'), '10'], env, dir);
        assert.equal(run.status, 2);
        assert.equal(existsSync(calls), false);
    });

    it('does not leave or reuse what an earlier run of the same name left, when a new run is not valid', () => {
        const bad = stubs('0 of 5 people connected');
        mkdirSync(join(bad.dir, 'data'));
        const out = join(bad.dir, 'out');
        mkdirSync(out);
        const old = ['on-5.worker.json', 'on-5.memory.tsv', 'on-5.load.json', 'on-5.load.log', 'on-5.container.txt', 'on-5.worker.log'];
        for (const f of old) writeFileSync(join(out, f), 'OLD RUN\n');
        const failed = sh('worker-load.sh', [join(bad.dir, 'data'), out, '30'], bad.env, bad.dir);
        assert.equal(failed.status, 1);
        // Nothing of the earlier run is left to be read as this one's result; what the new run wrote is its own
        for (const f of ['on-5.worker.json', 'on-5.memory.tsv', 'on-5.load.json']) assert.equal(existsSync(join(out, f)), false, `${f} of the earlier run is still there`);
        for (const f of ['on-5.load.log', 'on-5.container.txt', 'on-5.worker.log']) assert.doesNotMatch(readFileSync(join(out, f), 'utf8'), /OLD RUN/, `${f} is the earlier run's`);
    });

    it('stops with the reason kept when not everyone connected, and never starts the measured stretch', () => {
        const bad = stubs('0 of 5 people connected');
        mkdirSync(join(bad.dir, 'data'));
        const failed = sh('worker-load.sh', [join(bad.dir, 'data'), join(bad.dir, 'out'), '30'], bad.env, bad.dir);
        assert.equal(failed.status, 1);
        assert.match(readFileSync(join(bad.dir, 'out', 'on-5.INVALID.txt'), 'utf8'), /not all 5 people connected/);
        assert.doesNotMatch(readFileSync(bad.calls, 'utf8'), /kill -s USR2/);
    });

    it('goes on to measure when everyone connected: no INVALID record, and the measured stretch is started and ended', () => {
        const good = stubs('5 of 5 people connected');
        mkdirSync(join(good.dir, 'data'));
        // 30 s is the shortest run: 10 s of lead-in and tail, and 10 s measured; the stubs make it as fast as the sleeps in the script allow
        const ran = sh('worker-load.sh', [join(good.dir, 'data'), join(good.dir, 'out'), '30'], good.env, good.dir);
        assert.equal(ran.status, 0, ran.stderr);
        assert.equal(existsSync(join(good.dir, 'out', 'on-5.INVALID.txt')), false);
        const calls = readFileSync(good.calls, 'utf8');
        assert.match(calls, /docker kill -s USR2 worker-load/);
        assert.match(calls, /docker kill -s USR1 worker-load/);
        assert.ok(calls.indexOf('kill -s USR2') < calls.indexOf('kill -s USR1'), 'the stretch ends after it started');
    });
});

describe('the table of the load runs', () => {
    const workerFile = (extra: object) => ({ observer: 'off', seconds: 160, memory: { peakMb: 100, peakProcessRssMbSampled: 150, oomKills: 0 }, cpu: { coresUsed: 0.4, throttledSeconds: 0 }, eventLoopDelayMs: { p50: 5, p99: 6, max: 7 }, heard: { frames: 1000 }, ...extra });
    const table = (worker: object, loadMeasured: object) => {
        const dir = scratch();
        writeFileSync(join(dir, 'room-off-5.worker.json'), JSON.stringify(worker));
        writeFileSync(join(dir, 'room-off-5.load.json'), JSON.stringify({ joins: 5, leaves: 0, errors: [], measured: { sent: 990, ...loadMeasured } }));
        return spawnSync('python3', ['-I', join(root, 'scripts', 'worker-load-table.py'), dir], { encoding: 'utf8' });
    };

    it('says that heard and sent are not comparable when the stretches are not on record, or are not the same', () => {
        const older = table(workerFile({}), {});
        assert.equal(older.status, 0, older.stderr);
        assert.match(older.stdout, /Heard and sent are not directly comparable in:\n- room-off-5: .*not recorded/);
        const apart = table(workerFile({ measuredFrom: '2026-11-19T10:00:00Z', measuredTo: '2026-11-19T10:02:40Z' }), { from: '2026-11-19T10:00:00Z', to: '2026-11-19T10:02:45Z' });
        assert.match(apart.stdout, /room-off-5: .*differ by more than a second/);
        const same = table(workerFile({ measuredFrom: '2026-11-19T10:00:00Z', measuredTo: '2026-11-19T10:02:40Z' }), { from: '2026-11-19T10:00:00.4Z', to: '2026-11-19T10:02:40.6Z' });
        assert.doesNotMatch(same.stdout, /not directly comparable/);
    });
});

describe('the table of the load runs, for a worker that never became healthy', () => {
    it('lists it as not having lasted its run, with no memory trace, instead of failing on the missing file', () => {
        const dir = scratch();
        // What a run that was not valid leaves: how the container ended, and no memory trace
        writeFileSync(join(dir, 'on-5.container.txt'), 'running=false oom_killed=false exit_code=1\n');
        const result = spawnSync('python3', ['-I', join(root, 'scripts', 'worker-load-table.py'), dir], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Did not last its run: on-5 \(running=false oom_killed=false exit_code=1\)/);
        assert.match(result.stdout, /no memory trace was written/);
    });
});

describe('fetch-data.sh: the archive of spoken commands', () => {
    it('puts the folder in place when the archive also holds a __MACOSX folder, and ends well with the zip removed', () => {
        const dir = scratch();
        const archive = join(dir, 'made.zip');
        const made = spawnSync('python3', ['-I', '-c', `import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1],'w')\nz.writestr('mini_speech_commands/yes/a.wav','x')\nz.writestr('__MACOSX/mini_speech_commands/._a','x')\nz.close()`, archive], { encoding: 'utf8' });
        assert.equal(made.status, 0, made.stderr);
        // The part of the script that fetches and puts the archive in place, run with the download answered from the file made here
        const script = readFileSync(join(root, 'scripts', 'fetch-data.sh'), 'utf8');
        const part = script.slice(script.indexOf('# Extracted beside it'));
        const bin = join(dir, 'bin');
        mkdirSync(bin);
        writeFileSync(join(bin, 'curl'), `#!/bin/sh\ncase "$*" in *-o*) out=$3; cp "${archive}" "$out";; esac\nexit 0\n`);
        chmodSync(join(bin, 'curl'), 0o755);
        const data = join(dir, 'data');
        mkdirSync(data);
        const ran = spawnSync('bash', ['-c', `set -euo pipefail\ncd "$1"\n${part}`, 'x', data], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
        assert.equal(ran.status, 0, ran.stderr);
        assert.equal(existsSync(join(data, 'mini_speech_commands', 'yes', 'a.wav')), true);
        assert.equal(existsSync(join(data, 'mini_speech_commands.partial')), false);
        assert.equal(existsSync(join(data, 'mini_speech_commands.zip')), false);
    });
});

describe('image-check.sh', () => {
    function stubs(connected: string): { dir: string; env: NodeJS.ProcessEnv } {
        const dir = scratch();
        const bin = join(dir, 'bin');
        mkdirSync(bin);
        const stub = (name: string, body: string) => {
            writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
            chmodSync(join(bin, name), 0o755);
        };
        stub('docker', 'case "$1" in inspect) echo 1;; esac; exit 0');
        stub('strace', 'exit 0');
        stub('curl', 'exit 0');
        stub('hostname', 'exit 0');
        // The load generators end well (exit 0) and say how many people connected, as the real one does even when some could not join
        stub('npx', `echo "${connected}" >&2; exit 0`);
        return { dir, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } };
    }
    const run = (dir: string, env: NodeJS.ProcessEnv) => spawnSync('bash', [join(root, 'scripts', 'image-check.sh'), join(dir, 'data'), join(dir, 'out'), '1', '0'], { env, cwd: dir, encoding: 'utf8', timeout: 120000 });

    it('says a run is not valid when the load generators ended well but not everyone connected', () => {
        const bad = stubs('1 of 2 people connected');
        const ran = run(bad.dir, bad.env);
        assert.equal(ran.status, 1, ran.stdout + ran.stderr);
        assert.match(ran.stdout, /RUN INVALID:.*not all people connected/);
    });

    it('does not call a run invalid when everyone connected', () => {
        const good = stubs('2 of 2 people connected');
        const ran = run(good.dir, good.env);
        assert.doesNotMatch(ran.stdout, /RUN INVALID/);
        assert.equal(ran.status, 0, ran.stdout + ran.stderr);
    });
});

describe('yield-report.ts', () => {
    const outcome = (events: Array<[number, string]>, stopAt?: number) => ({ yieldAt: 1100, stopAt, pauses: 0, heldMs: 0, resumes: 0, continues: 0, spanMs: 9000, events, why: {} });
    const row = (id: string, kind: 'speech' | 'noise', events: Array<[number, string]>, stopAt?: number) => {
        const result = Object.fromEntries(['today', 'confirm', 'dip', 'strict', 'hold'].map((b) => [b, outcome(events, stopAt)]));
        return { id, kind, set: 'unit', label: kind === 'speech' ? 'speech' : 'nonspeech', condition: 'quiet', split: 'tune', provider: 'empty', seconds: 10, onsetMs: 1000, offsetMs: 3000, result };
    };
    const yieldReport = (args: string[]) => tsx(['src/yield-report.ts', ...args]);

    it('counts only the time at full volume as overlap: a second dip after the bot went back up closes it', () => {
        const dir = scratch();
        const rows = join(dir, 'rows.jsonl');
        // dip at 1.1 s, back up at 1.6 s, down again at 2.0 s, stopped at 2.3 s: 0.4 s at full volume (it was turned down the rest of the time)
        writeFileSync(rows, JSON.stringify(row('unit-speech-1', 'speech', [[1100, 'dip'], [1600, 'up'], [2000, 'dip'], [2300, 'stop']], 2300)) + '\n');
        const ran = yieldReport(['report', rows, join(dir, 'out.md')]);
        assert.equal(ran.status, 0, ran.stderr);
        // The dip row of the overlap table: overlap per clip median / p95, then the total
        const line = ran.stdout.split('\n').find((l) => l.startsWith('| turn down, then stop or back up |') && /\| [0-9.]+ s \|$/.test(l));
        assert.ok(line, ran.stdout);
        assert.match(line, /400 ms \/ 400 ms \| 0\.4 s \|$/);
    });

    it('refuses a sweep whose windows were not scored on the same clips as the 1500 ms run', () => {
        const dir = scratch();
        const clips = [row('unit-speech-1', 'speech', [[1100, 'pause']]), row('unit-speech-2', 'speech', [[1100, 'pause']]), row('unit-noise-1', 'noise', [])];
        for (const w of [300, 600, 1000, 1500]) {
            // The 300 ms run was made with REPLAY_LIMIT: one clip only
            const held = w === 300 ? clips.slice(0, 1) : clips;
            writeFileSync(join(dir, `yield-replay-tune-${w}.jsonl`), held.map((r) => JSON.stringify(r)).join('\n') + '\n');
        }
        const ran = yieldReport(['sweep', dir]);
        assert.notEqual(ran.status, 0);
        assert.match(ran.stderr, /the tune run for 300 ms was not scored on the same clips/);
        assert.equal(existsSync(join(dir, 'yield-sweep.md')), false);
    });
});

describe('worker-soak.sh', () => {
    it('does not leave what an earlier run of the same name left, when a new run is not valid', () => {
        const dir = scratch();
        const bin = join(dir, 'bin');
        mkdirSync(bin);
        const stub = (name: string, body: string) => {
            writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
            chmodSync(join(bin, name), 0o755);
        };
        stub('docker', 'case "$1" in inspect) echo "stub";; esac; exit 0');
        stub('curl', 'exit 0');
        stub('node', 'echo "0 of 9 people connected" >&2; sleep 30 >/dev/null 2>&1 & wait');
        mkdirSync(join(dir, 'data'));
        const out = join(dir, 'out');
        mkdirSync(out);
        const result = ['worker.json', 'trace.tsv', 'shutdown.json', 'lane.load.json', 'room.load.json', 'times.txt', 'exit.txt'].map((f) => `soak-on.${f}`);
        for (const f of result) writeFileSync(join(out, f), 'OLD RUN\n');
        const run = spawnSync('sh', [join(root, 'scripts', 'worker-soak.sh'), join(dir, 'data'), out, '30'], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNS: 'on' }, cwd: dir, encoding: 'utf8', timeout: 60000 });
        assert.equal(run.status, 1);
        assert.match(readFileSync(join(out, 'soak-on.INVALID.txt'), 'utf8'), /not all 9 people connected/);
        for (const f of result) assert.equal(existsSync(join(out, f)), false, `${f} of the earlier run is still there`);
    });
});

describe('worker-telemetry-check.sh', () => {
    it('reports a missing summary, not an earlier run\'s, when the worker fails before it writes one', () => {
        const dir = scratch();
        const bin = join(dir, 'bin');
        mkdirSync(bin);
        // The tracer (and so the worker) fails at once; nothing it would write is written
        for (const [name, body] of Object.entries({ strace: 'exit 1', curl: 'exit 0', npx: 'exit 0' })) {
            writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
            chmodSync(join(bin, name), 0o755);
        }
        const out = join(dir, 'out');
        mkdirSync(out);
        const earlier = JSON.stringify({ heard: { frames: 99999 }, observerWork: { status: 'on', windows: { accepted: 7 }, errors: 0 } });
        for (const name of ['worker-observer-off', 'worker-observer-on']) {
            writeFileSync(join(out, `${name}.summary.json`), earlier);
            writeFileSync(join(out, `${name}.load.json`), 'OLD RUN');
            writeFileSync(join(out, `${name}.strace`), 'OLD RUN');
            writeFileSync(join(out, `${name}.log`), 'OLD RUN');
        }
        const run = spawnSync('bash', [join(root, 'scripts', 'worker-telemetry-check.sh'), join(dir, 'data'), '0', '0'], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OUT: out }, cwd: dir, encoding: 'utf8', timeout: 120000 });
        assert.doesNotMatch(run.stdout, /99999/);
        assert.equal((run.stdout.match(/summary missing/g) ?? []).length, 2, run.stdout + run.stderr);
        for (const name of ['worker-observer-off', 'worker-observer-on']) {
            assert.equal(existsSync(join(out, `${name}.summary.json`)), false);
            assert.equal(existsSync(join(out, `${name}.load.json`)), false);
            assert.doesNotMatch(readFileSync(join(out, `${name}.strace`), 'utf8'), /OLD RUN/);
            assert.doesNotMatch(readFileSync(join(out, `${name}.log`), 'utf8'), /OLD RUN/);
        }
    });
});
