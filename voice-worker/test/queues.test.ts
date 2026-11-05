// The line of waiting messages kept for each bubble (a bot server connection handles one bubble's messages in order).
// It must not grow for bubbles that never opened, and must not let a bubble's message run while its close is still going.
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { VoiceWorker } from '../src/server.ts';
import { waitFor } from './wait.ts';

let worker: VoiceWorker | undefined;
afterEach(async () => {
    await worker?.close();
    worker = undefined;
});

async function connect(): Promise<{ ws: WebSocket; received: Array<Record<string, unknown>>; queues: () => Map<string, Promise<void>> }> {
    worker = new VoiceWorker({ port: 0, host: '127.0.0.1', maxLanes: 5, maxSessionsPerConnection: 4, ice: { iceServers: [] } });
    const port = await worker.listen();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge?botId=bot1`);
    const received: Array<Record<string, unknown>> = [];
    ws.on('message', (data) => received.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
    });
    const queues = () => {
        const connections = (worker as unknown as { connections: Set<{ queues: Map<string, Promise<void>> }> }).connections;
        return [...connections][0].queues;
    };
    await waitFor('the connection', () => (worker as unknown as { connections: Set<unknown> }).connections.size === 1);
    return { ws, received, queues };
}

describe('the line of waiting messages for each bubble', () => {
    it('leaves nothing behind for bubbles that never opened', async () => {
        const c = await connect();
        for (let i = 0; i < 20; i++) c.ws.send(JSON.stringify({ type: 'voice.stop', reason: 'other', ts: Date.now(), sessionId: `ghost.${i}` }));
        await waitFor('twenty answers', () => c.received.filter((m) => m.code === 'no_session').length === 20);
        await waitFor('the lines to empty', () => c.queues().size === 0);
        c.ws.close();
    });

    it('leaves nothing behind once a bubble has opened and ended', async () => {
        const c = await connect();
        c.ws.send(JSON.stringify({ type: 'session.open', ts: Date.now(), sessionId: 'b.1', bubbleId: 'bubble', botId: 'bot1' }));
        await waitFor('the bubble to start', () => c.received.some((m) => m.type === 'session.start'));
        c.ws.send(JSON.stringify({ type: 'session.end', ts: Date.now(), sessionId: 'b.1' }));
        await waitFor('the line to empty', () => c.queues().size === 0);
        // A message for it afterwards is answered as an unknown bubble
        c.ws.send(JSON.stringify({ type: 'voice.stop', reason: 'other', ts: Date.now(), sessionId: 'b.1' }));
        await waitFor('the unknown answer', () => c.received.some((m) => m.code === 'no_session'));
        c.ws.close();
    });
});
