// Checks the speech observer's detector as this image holds it, through the worker's own loader: the pinned model, the
// runtime's native library for this machine, and one answer from each way of calling it. It listens to nothing and
// starts no worker. In the built image:
//   docker run --rm --network none <image> node --import tsx speech-observer/check.mts
import { existsSync, readdirSync } from 'node:fs';
import { CONTEXT, STATE, WINDOW } from '../src/speechObserver.ts';
import { sileroLoader } from '../src/speechObserverRuntime.ts';

const modelPath = process.env.VOICE_SPEECH_OBSERVER_MODEL ?? '';
const runtime = process.env.VOICE_SPEECH_OBSERVER_RUNTIME ?? '';
const model = await sileroLoader({ modelPath, runtime })();
const silence = () => ({ input: new Float32Array(CONTEXT + WINDOW), state: new Float32Array(STATE) });
const one = await model.run(silence().input, silence().state);
const three = await model.runMany!([silence(), silence(), silence()]);
await model.release?.();
const natives = `${runtime}/bin/napi-v6`;
console.log(
    JSON.stringify({
        ok: three.every((answer) => answer.probability === one.probability) && one.probability >= 0 && one.probability < 0.5,
        switchedOn: process.env.VOICE_SPEECH_OBSERVER === '1',
        reportingOff: process.env.ORT_DISABLE_TELEMETRY === '1',
        modelPath,
        runtime,
        node: process.version,
        arch: process.arch,
        nativeFiles: existsSync(natives) ? readdirSync(natives).flatMap((os) => readdirSync(`${natives}/${os}`).map((arch) => `${os}/${arch}`)) : [],
        silenceProbability: Number(one.probability.toFixed(6)),
    })
);
