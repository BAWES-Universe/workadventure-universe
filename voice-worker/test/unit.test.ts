import { describe, expect, it } from 'vitest';
import { optionsFromEnv } from '../src/config.ts';
import { Down3, Up2 } from '../src/dsp.ts';
import { FakeSpeech } from '../src/fakeSpeech.ts';
import { checkMessage } from '../src/validate.ts';

const rms = (x: Int16Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
const tone = (hz: number, rate: number, samples: number) => Int16Array.from({ length: samples }, (_, i) => Math.round(8000 * Math.sin((2 * Math.PI * hz * i) / rate)));

describe('resamplers', () => {
    it('turns a 20 ms frame at 48 kHz into 320 samples at 16 kHz and keeps a speech-band tone at its level', () => {
        const down = new Down3();
        let out = new Int16Array(0);
        for (let f = 0; f < 10; f++) out = down.process(tone(440, 48000, 960));
        expect(out.length).toBe(320);
        expect(rms(out) / rms(tone(440, 48000, 960))).toBeGreaterThan(0.95);
        expect(rms(out) / rms(tone(440, 48000, 960))).toBeLessThan(1.05);
    });

    it('doubles the rate of bot speech and keeps its level', () => {
        const up = new Up2();
        let out = new Int16Array(0);
        for (let f = 0; f < 10; f++) out = up.process(tone(440, 24000, 480));
        expect(out.length).toBe(960);
        expect(rms(out) / rms(tone(440, 24000, 480))).toBeGreaterThan(0.95);
        expect(rms(out) / rms(tone(440, 24000, 480))).toBeLessThan(1.05);
    });
});

describe('fake speech', () => {
    const speech = new FakeSpeech();

    it('makes 960 bytes per 20 ms frame at 24 kHz mono, never 1920', () => {
        expect(speech.frameBytes).toBe(960);
        expect(speech.synth('hi').length * 2).toBe(speech.durationMs('hi') * 48);
    });

    it('lasts as long as the text suggests, at least 400 ms, in whole frames', () => {
        expect(speech.durationMs('a')).toBe(400);
        expect(speech.durationMs('x'.repeat(100)) % 20).toBe(0);
        expect(speech.durationMs('x'.repeat(100))).toBeGreaterThan(speech.durationMs('x'.repeat(20)));
    });

    it('is audible, and differs from one sentence to the next', () => {
        const a = speech.synth('first sentence');
        const b = speech.synth('a different sentence');
        expect(rms(a)).toBeGreaterThan(1000);
        expect(Array.from(a.subarray(0, 480))).not.toEqual(Array.from(b.subarray(0, 480)));
    });
});

describe('bridge messages', () => {
    const base = { sessionId: 's1' };

    it('accepts what the bot server sends', () => {
        expect(checkMessage('fromBot', { ...base, type: 'session.open', bubbleId: 'b', botId: 'x' })).toBeNull();
        expect(checkMessage('fromBot', { ...base, type: 'lane.open', participantId: 'p', epoch: 1, mode: 'talk' })).toBeNull();
        expect(checkMessage('fromBot', { ...base, type: 'lane.signal', participantId: 'p', epoch: 2, signal: { type: 'offer', sdp: 'v=0' } })).toBeNull();
        expect(checkMessage('fromBot', { ...base, type: 'lane.signal', participantId: 'p', epoch: 2, signal: { type: 'candidate', candidate: { candidate: 'c', sdpMLineIndex: null, sdpMid: null } } })).toBeNull();
        expect(checkMessage('fromBot', { ...base, type: 'bot.say', segmentId: 'g', text: 'hello', committed: true })).toBeNull();
    });

    it('accepts the LiveKit messages, and refuses ones that are not a room address, a token, or a list of people', () => {
        expect(checkMessage('fromBot', { ...base, type: 'room.join', epoch: 3, serverUrl: 'wss://livekit.example', token: 'jwt' })).toBeNull();
        expect(checkMessage('fromBot', { ...base, type: 'room.leave', epoch: 3 })).toBeNull();
        expect(checkMessage('fromBot', { ...base, type: 'room.people', epoch: 3, people: [{ participantId: 'p', mode: 'talk' }] })).toBeNull();
        expect(checkMessage('fromWorker', { ...base, type: 'room.state', epoch: 3, state: 'connected' })).toBeNull();
        expect(checkMessage('fromWorker', { ...base, type: 'engine.status', engineId: 'e', voice: 'active', mode: 'talk', lanes: [], room: { epoch: 3, connected: true } })).toBeNull();
        expect(checkMessage('fromBot', { ...base, type: 'room.join', epoch: 3, serverUrl: 'http://livekit.example', token: 'jwt' })).not.toBeNull();
        expect(checkMessage('fromBot', { ...base, type: 'room.join', epoch: 3, serverUrl: 'wss://livekit.example', token: '' })).not.toBeNull();
        expect(checkMessage('fromBot', { ...base, type: 'room.join', serverUrl: 'wss://livekit.example', token: 'jwt' })).not.toBeNull();
        expect(checkMessage('fromBot', { ...base, type: 'room.people', epoch: 3, people: [{ participantId: 'p', mode: 'shout' }] })).not.toBeNull();
        expect(checkMessage('fromBot', { ...base, type: 'room.state', epoch: 3, state: 'connected' })).not.toBeNull();
        expect(checkMessage('fromWorker', { ...base, type: 'room.join', epoch: 3, serverUrl: 'wss://x', token: 't' })).not.toBeNull();
    });

    it('accepts the request for an audio line, and nothing else shaped like it', () => {
        const request = { type: 'transceiverRequest', transceiverRequest: { kind: 'audio', init: { direction: 'recvonly' } } };
        expect(checkMessage('fromWorker', { ...base, type: 'lane.signal', participantId: 'p', epoch: 1, signal: request })).toBeNull();
        expect(checkMessage('fromWorker', { ...base, type: 'lane.signal', participantId: 'p', epoch: 1, signal: { type: 'transceiverRequest', transceiverRequest: { kind: 'video' } } })).not.toBeNull();
    });

    it('refuses what breaks the contract', () => {
        expect(checkMessage('fromBot', { ...base, type: 'lane.open', participantId: 'p' })).not.toBeNull(); // no epoch
        expect(checkMessage('fromBot', { ...base, type: 'lane.open', participantId: 'p', epoch: 0 })).not.toBeNull();
        expect(checkMessage('fromBot', { ...base, type: 'bot.say', segmentId: 'g', text: 'hello', committed: false })).not.toBeNull();
        expect(checkMessage('fromBot', { ...base, type: 'mode.set', mode: 'shout' })).not.toBeNull();
        expect(checkMessage('fromBot', { ...base, type: 'lane.signal', participantId: 'p', epoch: 1, signal: { type: 'offer', sdp: 'x'.repeat(70000) } })).not.toBeNull();
        expect(checkMessage('fromBot', { ...base, type: 'lane.signal', participantId: 'p', epoch: 1, signal: { type: 'renegotiate' } })).not.toBeNull();
        expect(checkMessage('fromBot', { type: 'session.end' })).not.toBeNull(); // no session
        expect(checkMessage('fromBot', 'text')).not.toBeNull();
        expect(checkMessage('fromBot', { ...base, type: 'nope' })).not.toBeNull();
    });

    it('does not let the bot server send what only the worker sends, or the other way round', () => {
        expect(checkMessage('fromBot', { ...base, type: 'participant.join', participantId: 'p', epoch: 1 })).not.toBeNull();
        expect(checkMessage('fromWorker', { ...base, type: 'lane.open', participantId: 'p', epoch: 1 })).not.toBeNull();
        expect(checkMessage('fromWorker', { ...base, type: 'participant.join', participantId: 'p', epoch: 1 })).toBeNull();
    });
});

describe('settings', () => {
    it('work without any environment, and stay on this machine unless told otherwise', () => {
        const options = optionsFromEnv({});
        expect(options).toMatchObject({ port: 8830, host: '127.0.0.1', maxLanes: 200, maxUtteranceSeconds: 180 });
        expect(options.secret).toBeUndefined();
    });

    it('read the port, limits, secret and network settings from the environment', () => {
        const options = optionsFromEnv({
            VOICE_WORKER_PORT: '9000',
            VOICE_WORKER_HOST: '0.0.0.0',
            VOICE_WORKER_SECRET: 'abc',
            VOICE_MAX_LANES: '12',
            VOICE_MAX_UTTERANCE_SECONDS: '90',
            VOICE_ICE_PORT_RANGE: '40000-40100',
            VOICE_PUBLIC_IP: '203.0.113.7, 203.0.113.8',
            VOICE_ICE_SERVERS: '[{"urls":"stun:stun.example:3478"}]',
        });
        expect(options).toMatchObject({ port: 9000, host: '0.0.0.0', secret: 'abc', maxLanes: 12, maxUtteranceSeconds: 90 });
        expect(options.ice).toEqual({
            icePortRange: [40000, 40100],
            iceAdditionalHostAddresses: ['203.0.113.7', '203.0.113.8'],
            iceServers: [{ urls: 'stun:stun.example:3478' }],
        });
    });
});
