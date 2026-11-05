// Process entry point of the voice worker. Run with `npm start`.
import { optionsFromEnv, startupProblem } from './config.ts';
import { VoiceWorker } from './server.ts';

const options = optionsFromEnv();
const problem = startupProblem(options);
if (problem) {
    console.error(`[voice-worker] ${problem}`);
    process.exit(1);
}
const worker = new VoiceWorker(options);
const port = await worker.listen();
console.log(`[voice-worker] listening on ${options.host}:${port} (max ${options.maxLanes} audio connections)`);

let stopping = false;
const stop = async () => {
    if (stopping) return;
    stopping = true;
    await worker.close();
    process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
