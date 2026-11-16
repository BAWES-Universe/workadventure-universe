// Loads the runtime, runs inference, idles, shuts down. Run under a system-call trace with no route out, to see whether
// the runtime itself tries to reach anything (see scripts/telemetry-check.sh).
//   tsx src/telemetry-probe.ts <model> <native|wasm> <idle seconds>
import { SileroModel, type Runtime } from './silero.ts';

const [modelPath, runtime, idle] = process.argv.slice(2);
const model = await SileroModel.load(modelPath, runtime as Runtime);
const stream = model.stream();
for (let i = 0; i < 200; i++) await stream.push(new Int16Array(512).fill(i % 2 ? 900 : -900));
await new Promise((resolve) => setTimeout(resolve, Number(idle) * 1000));
for (let i = 0; i < 50; i++) await stream.push(new Int16Array(512));
console.log(`${runtime}: done`);
