// The image's detector check (speech-observer/check.mts) must fail as a command when the check fails, not only say so,
// or a build or deployment step that looks at the exit status would let a broken detector through. The command with the
// real model and native runtime is run in the built image (voice-vad-eval/scripts/image-check.sh); CI does not install the
// runtime, so here the loader is swapped for a detector made in the test.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkDetector } from '../speech-observer/checkDetector.mts';
import { type DetectorModel, STATE } from '../src/speechObserver.ts';

const answering = (probability: (call: number) => number, many = true): DetectorModel => {
    let n = 0;
    const answer = () => ({ probability: probability(n++), state: new Float32Array(STATE) });
    return { run: async () => answer(), runMany: many ? async (items) => items.map(answer) : undefined };
};

describe('the image check of the detector', () => {
    it('passes a detector that calls silence silence, the same way each way it is called', async () => {
        expect(await checkDetector(answering(() => 0.002))).toEqual({ ok: true, failures: [], silenceProbability: 0.002 });
    });

    it.each([
        ['silence taken for speech', answering(() => 0.9), 'silence taken for speech'],
        ['not a probability', answering(() => Number.NaN), 'not a probability'],
        ['several at once answering differently from one', answering((n) => (n === 0 ? 0.002 : 0.003)), 'answers differ'],
        ['no way to call it for several people', answering(() => 0.002, false), 'several people at once'],
    ])('fails a detector with %s, and says why', async (_, model, why) => {
        const check = await checkDetector(model);
        expect(check.ok).toBe(false);
        expect(check.failures.join('; ')).toContain(why);
    });

    const root = fileURLToPath(new URL('..', import.meta.url));
    const run = (env: Record<string, string>) =>
        spawnSync(process.execPath, ['--import', 'tsx', 'speech-observer/check.mts'], { cwd: root, encoding: 'utf8', env: { ...process.env, ORT_DISABLE_TELEMETRY: '1', ...env } });

    const withFake = (probability: string) =>
        spawnSync(process.execPath, ['--import', 'tsx', '--import', './test/fixtures/checkWithFakeDetector.mjs', 'speech-observer/check.mts'], {
            cwd: root,
            encoding: 'utf8',
            env: { ...process.env, ORT_DISABLE_TELEMETRY: '1', FAKE_DETECTOR_PROBABILITY: probability },
        });

    it('as a command, fails with status 1 when the check fails, and still prints what it found', () => {
        const result = withFake('0.9');
        expect(result.status).toBe(1);
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, silenceProbability: 0.9 });
        expect(result.stderr).toContain('speech observer check failed: one call: silence taken for speech (0.9)');
    });

    it('as a command, exits 0 when the check passes', () => {
        const result = withFake('0.002');
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, failures: [], silenceProbability: 0.002, reportingOff: true });
        expect(result.stderr).toBe('');
    });

    it('as a command, fails with a non-zero status when it cannot load the pinned model', () => {
        const result = run({ VOICE_SPEECH_OBSERVER_MODEL: `${root}package.json`, VOICE_SPEECH_OBSERVER_RUNTIME: `${root}speech-observer/node_modules/onnxruntime-node` });
        expect(result.status).not.toBe(0);
        expect(result.stdout).toBe('');
    });
});
