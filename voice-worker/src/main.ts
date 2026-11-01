// Process entry point of the voice worker. Run with `npm start`.
import { optionsFromEnv } from './config.ts';
import { VoiceWorker } from './server.ts';

const options = optionsFromEnv();
const worker = new VoiceWorker(options);
const port = await worker.listen();
console.log(`[voice-worker] listening on ${options.host}:${port} (max ${options.maxLanes} audio connections)`);
if (!options.secret && options.host !== '127.0.0.1') {
    console.warn('[voice-worker] VOICE_WORKER_SECRET is not set: any client that can reach this port can use the worker');
}

let stopping = false;
const stop = async () => {
    if (stopping) return;
    stopping = true;
    await worker.close();
    process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
