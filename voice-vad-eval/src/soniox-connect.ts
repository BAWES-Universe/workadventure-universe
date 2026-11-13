// How long a Soniox stream takes to open from THIS machine (through its proxy), and to answer a finished empty stream:
// the part of the recorded first-word times that is connection setup here, not the model. Sends 0.5 s of silence per stream.
//   tsx src/soniox-connect.ts <out json> [streams, default 10]
import './proxy.ts';
import { writeFileSync } from 'node:fs';
import WebSocket from 'ws';
import { SONIOX_ENDPOINT, SONIOX_CURRENT_MODEL } from '../../voice-worker/src/soniox.ts';

const [outPath, countArg] = process.argv.slice(2);
const key = process.env.SONIOX_API_KEY;
if (!key || !outPath) throw new Error('usage: soniox-connect.ts <out json> [streams]; needs SONIOX_API_KEY');
const results: { openMs: number; finishedMs: number }[] = [];
for (let i = 0; i < Number(countArg ?? 10); i++) {
    const start = performance.now();
    const r = await new Promise<{ openMs: number; finishedMs: number }>((resolve, reject) => {
        const ws = new WebSocket(SONIOX_ENDPOINT, { headers: { Authorization: `Bearer ${key}` } });
        let openMs = NaN;
        let sentAt = 0;
        ws.on('open', () => {
            openMs = performance.now() - start;
            ws.send(JSON.stringify({ model: SONIOX_CURRENT_MODEL, audio_format: 's16le', sample_rate: 16000, num_channels: 1 }));
            ws.send(Buffer.alloc(16000));
            ws.send('');
            sentAt = performance.now();
        });
        ws.on('message', (d) => {
            const m = JSON.parse(d.toString()) as { finished?: boolean };
            if (m.finished) {
                resolve({ openMs: Math.round(openMs), finishedMs: Math.round(performance.now() - sentAt) });
                ws.close();
            }
        });
        ws.on('error', reject);
    });
    results.push(r);
}
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const summary = { streams: results.length, openMsMedian: med(results.map((r) => r.openMs)), openMsMax: Math.max(...results.map((r) => r.openMs)), finishedAfterEndMsMedian: med(results.map((r) => r.finishedMs)), results };
writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary));
