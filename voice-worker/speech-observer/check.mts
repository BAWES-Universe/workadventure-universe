// Checks the speech observer's detector as this image holds it, through the worker's own loader: the pinned model, the
// runtime's native library for this machine, and one answer from each way of calling it. It listens to nothing and
// starts no worker. It prints what it found as one line of JSON, and exits with 1 if the check failed (and with an
// error if the model or runtime cannot be loaded at all), so it can stand as a build or deployment step. In the image:
//   docker run --rm --network none <image> node --import tsx speech-observer/check.mts
import { existsSync, readdirSync } from 'node:fs';
import { sileroLoader } from '../src/speechObserverRuntime.ts';
import { checkDetector } from './checkDetector.mts';

const modelPath = process.env.VOICE_SPEECH_OBSERVER_MODEL ?? '';
const runtime = process.env.VOICE_SPEECH_OBSERVER_RUNTIME ?? '';
const model = await sileroLoader({ modelPath, runtime })();
const check = await checkDetector(model);
await model.release?.();
const natives = `${runtime}/bin/napi-v6`;
console.log(
    JSON.stringify({
        ok: check.ok,
        failures: check.failures,
        switchedOn: process.env.VOICE_SPEECH_OBSERVER !== '0',
        reportingOff: process.env.ORT_DISABLE_TELEMETRY === '1',
        modelPath,
        runtime,
        node: process.version,
        arch: process.arch,
        nativeFiles: existsSync(natives) ? readdirSync(natives).flatMap((os) => readdirSync(`${natives}/${os}`).map((arch) => `${os}/${arch}`)) : [],
        silenceProbability: check.silenceProbability,
    })
);
if (!check.ok) {
    console.error(`speech observer check failed: ${check.failures.join('; ')}`);
    process.exitCode = 1;
}
