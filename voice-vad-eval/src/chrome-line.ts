// A real Chromium as one person on the proximity path of a built worker, with the bot server's relay in between.
// Shared by chrome-timing.ts (paired timing) and chrome-offswitch.ts (the engineers' off switch with a call running).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { VoiceCalls } from '../../bots/voice/VoiceCalls.ts';
import { WorkerLink } from '../../bots/voice/VoiceLink.ts';
import type { FromWorker, ToWorker } from '../../bots/voice/protocol.ts';
import { FakeGame, privateEvent, sleep } from '../../voice-worker/test/harness.ts';

const { AccessToken, TrackSource: GrantSource } = createRequire(new URL('../../voice-worker/', import.meta.url))('livekit-server-sdk') as typeof import('livekit-server-sdk');
const LK_WS = process.env.LIVEKIT_WS_URL ?? 'ws://127.0.0.1:7880';
const LK_KEY = process.env.LIVEKIT_API_KEY ?? 'devkey';
const LK_SECRET = process.env.LIVEKIT_API_SECRET ?? 'secret-secret-secret-secret-12345';

const { chromium } = createRequire(`${process.env.PLAYWRIGHT_DIR ?? '/opt/node-tools'}/`)('playwright') as typeof import('playwright');

// ---- audio ----
function wav16k(path: string): Int16Array {
    const b = readFileSync(path);
    let at = 12;
    while (at < b.length - 8) {
        const id = b.toString('ascii', at, at + 4);
        const size = b.readUInt32LE(at + 4);
        if (id === 'data') return new Int16Array(b.buffer.slice(b.byteOffset + at + 8, b.byteOffset + at + 8 + size));
        at += 8 + size + (size % 2);
    }
    throw new Error(`no audio in ${path}`);
}
function atLevel(pcm: Int16Array, dbfs: number): Float32Array {
    let sum = 0;
    for (const v of pcm) sum += v * v;
    const gain = 10 ** (dbfs / 20) / Math.max(1, Math.sqrt(sum / pcm.length)) ;
    return Float32Array.from(pcm, (v) => Math.max(-1, Math.min(1, v * gain)));
}
/** Drops the leading quiet so the first sample is where speech starts. */
function trimLead(x: Float32Array): Float32Array {
    for (let i = 0; i + 320 < x.length; i += 160) {
        let e = 0;
        for (let j = 0; j < 320; j++) e += x[i + j] * x[i + j];
        if (Math.sqrt(e / 320) > 0.02) return x.slice(i);
    }
    return x;
}
const b64 = (x: Float32Array): string => Buffer.from(x.buffer, x.byteOffset, x.byteLength).toString('base64');

// ---- the page: a person's browser ----
const PAGE = `
window.loud = [];
window.initAudio = async (noiseB64, speechB64) => {
  const dec = (s) => { const u = Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); return new Float32Array(u.buffer); };
  const ac = (window.ac = new AudioContext({ sampleRate: 48000 }));
  const dest = (window.dest = ac.createMediaStreamDestination());
  const mk = (data) => { const b = ac.createBuffer(1, data.length, 16000); b.copyToChannel(data, 0); return b; };
  window.noiseBuf = mk(dec(noiseB64));
  window.speechBuf = mk(dec(speechB64));
  window.noiseGain = ac.createGain(); window.noiseGain.gain.value = 0; window.noiseGain.connect(dest);
  window.speechGain = ac.createGain(); window.speechGain.gain.value = 1; window.speechGain.connect(dest);
  const n = ac.createBufferSource(); n.buffer = window.noiseBuf; n.loop = true; n.connect(window.noiseGain); n.start();
  const code = 'class P extends AudioWorkletProcessor{process(i){const c=i[0][0];if(c){let s=0;for(let k=0;k<c.length;k++)s+=c[k]*c[k];this.port.postMessage(Math.sqrt(s/c.length));}return true;}}registerProcessor("p",P);';
  await ac.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
  await ac.resume();
};
// listens to a remote stream: an audio element (so the browser really plays it) and a worklet that times when it is loud
window.listen = (stream) => {
  const a = document.createElement('audio'); a.srcObject = stream; a.autoplay = true; document.body.appendChild(a); a.play().catch(() => {});
  const node = new AudioWorkletNode(window.ac, 'p');
  window.ac.createMediaStreamSource(stream).connect(node);
  node.port.onmessage = (m) => { if (m.data > 0.009) window.loud.push(performance.timeOrigin + performance.now()); };
};
window.setup = async (noiseB64, speechB64) => {
  await window.initAudio(noiseB64, speechB64);
  if (window.pc) { try { window.pc.close(); } catch (e) {} }
  const pc = (window.pc = new RTCPeerConnection({ iceServers: [] }));
  pc.addTrack(window.dest.stream.getAudioTracks()[0], window.dest.stream);
  pc.createDataChannel('data');
  pc.onicecandidate = (e) => { if (e.candidate) window.sendSignal(JSON.stringify({ type: 'candidate', candidate: { candidate: e.candidate.candidate, sdpMLineIndex: e.candidate.sdpMLineIndex ?? 0, sdpMid: e.candidate.sdpMid ?? '0' } })); };
  pc.ontrack = (e) => window.listen(e.streams[0] || new MediaStream([e.track]));
  await pc.setLocalDescription(await pc.createOffer());
  return JSON.stringify({ type: 'offer', sdp: pc.localDescription.sdp });
};
window.setupLk = async (noiseB64, speechB64, url, token) => {
  await window.initAudio(noiseB64, speechB64);
  const LK = window.LivekitClient;
  if (window.__lkdebug) LK.setLogLevel('debug');
  const room = (window.room = new LK.Room({ adaptiveStream: false, dynacast: false }));
  room.on(LK.RoomEvent.TrackSubscribed, (track) => { if (track.kind === 'audio') window.listen(new MediaStream([track.mediaStreamTrack])); });
  await room.connect(url, token, { autoSubscribe: true });
  await room.localParticipant.publishTrack(window.dest.stream.getAudioTracks()[0], { source: LK.Track.Source.Microphone });
};
window.lkState = () => (window.room ? window.room.state : 'none');
window.accept = async (json) => {
  const s = JSON.parse(json);
  if (s.type === 'answer') await pc.setRemoteDescription({ type: 'answer', sdp: s.sdp });
  else if (s.type === 'candidate') await pc.addIceCandidate(s.candidate);
  else if (s.type === 'transceiverRequest') {
    pc.addTransceiver(s.transceiverRequest.kind, { direction: (s.transceiverRequest.init && s.transceiverRequest.init.direction) || 'recvonly' });
    await pc.setLocalDescription(await pc.createOffer());
    window.sendSignal(JSON.stringify({ type: 'offer', sdp: pc.localDescription.sdp }));
  }
};
// source: 'silence' | 'noise' | 'speech' | 'noise+speech'; returns the moment (epoch ms) it was switched
window.speechNode = null;
window.setSource = (kind) => {
  const now = performance.timeOrigin + performance.now();
  window.noiseGain.gain.value = kind.includes('noise') ? 1 : 0;
  if (window.speechNode) { try { window.speechNode.stop(); } catch (e) {} window.speechNode = null; }
  if (kind.includes('speech')) { const s = ac.createBufferSource(); s.buffer = window.speechBuf; s.loop = true; s.connect(window.speechGain); s.start(); window.speechNode = s; }
  return now;
};
window.takeLoud = () => { const x = window.loud; window.loud = []; return x; };
window.peek = () => window.loud.length;
window.state = () => (window.pc ? window.pc.connectionState : 'none');
`;


export interface Rig {
    browser: import('playwright').Browser;
    fixturePort: number;
    noiseB64: string;
    speechB64: string;
}
export async function openRig(noisePath: string, speechPath: string, fixturePort: number): Promise<Rig> {
    const noise = atLevel(wav16k(noisePath), -30);
    const speech = trimLead(atLevel(wav16k(speechPath), -20));
    const browser = await chromium.launch({
        args: ['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns,LocalNetworkAccessChecks,PrivateNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessForWorkers,PrivateNetworkAccessForNavigations', '--use-fake-ui-for-media-stream', '--no-sandbox', '--no-proxy-server'],
    });
    return { browser, fixturePort, noiseB64: b64(noise), speechB64: b64(speech) };
}

export class Line {
    readonly game = new FakeGame();
    readonly fromWorker: (FromWorker & { at: number })[] = [];
    link!: WorkerLink;
    calls!: VoiceCalls;
    page!: import('playwright').Page;
    constructor(readonly behaviour: 'today' | 'pause', readonly port: number, readonly rig: Rig, readonly transport: 'proximity' | 'livekit' = 'proximity') {
        // Two lines share one LiveKit server: each its own room
        if (transport === 'livekit') this.game.spaceName = `chrome-${behaviour}-${port}-${process.pid}`;
    }

    async counters(): Promise<Record<string, number>> {
        const stats = (await (await fetch(`http://127.0.0.1:${this.port}/stats`)).json()) as { counters?: Record<string, number> };
        return stats.counters ?? {};
    }

    async start(): Promise<void> {
        this.calls = new VoiceCalls('bot1', this.game, (handlers) => {
            this.link = new WorkerLink({
                url: `ws://127.0.0.1:${this.port}`,
                botId: 'bot1',
                onMessage: (message) => {
                    this.fromWorker.push(Object.assign(message, { at: Date.now() }) as never);
                    handlers.onMessage(message);
                },
                onUp: handlers.onUp,
                onDown: handlers.onDown,
            });
            const send = this.link.send.bind(this.link);
            this.link.send = (message: ToWorker) =>
                send(message.type === 'session.open' ? ({ ...message, recognition: { adapter: 'soniox', model: 'stt-rt-v6', key: 'fixture', endpoint: `ws://127.0.0.1:${this.rig.fixturePort}`, language: 'en' } } as ToWorker) : message);
            this.link.start();
            return this.link;
        });
        await waitFor('the relay to reach the worker', () => this.link.isUp(), 15_000);
        this.calls.spaceUsers(this.game.spaceName, [{ spaceUserId: 'alice', uuid: 'uuid-alice', tags: [], name: 'alice' } as never]);
        this.page = await this.rig.browser.newPage();
        // a secure origin (localhost), so that AudioWorklet exists
        if (process.env.CHROME_LOG) this.page.on('console', (m) => console.error('page:', m.text().slice(0, 300)));
        await this.page.route('http://localhost:9/', (r) => r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
        await this.page.goto('http://localhost:9/');
        await this.page.exposeFunction('sendSignal', (signal: string) => this.calls.handlePrivateEvent(privateEvent(this.game, 'alice', { $case: 'webRtcSignal', webRtcSignal: { signal } })));
        await this.page.evaluate(PAGE);
        if (this.transport === 'livekit') return this.startLivekit();
        this.game.humans.set('alice', { accept: (json: string) => this.page.evaluate((j) => (window as never as { accept: (j: string) => Promise<void> }).accept(j), json) } as never);
        // When the bot asks the person to start again (after the worker came back), a browser makes a new connection
        this.game.sendStart = () => void this.connect().catch((e) => console.error('chrome reconnect failed', e));
        await this.connect();
        await waitFor('the audio connection', () => this.fromWorker.some((m) => m.type === 'participant.join'), 20_000);
        await waitFor('chrome to be connected', async () => (await this.page.evaluate(() => (window as never as { state: () => string }).state())) === 'connected' || undefined, 20_000).catch(() => undefined);
    }

    private async startLivekit(): Promise<void> {
        const bot = new AccessToken(LK_KEY, LK_SECRET, { identity: this.game.botId, name: this.game.botId });
        bot.addGrant({ room: this.game.spaceName, roomJoin: true, canSubscribe: true, canPublish: true, canPublishSources: [GrantSource.MICROPHONE] });
        this.calls.spaceUsers(this.game.spaceName, [{ spaceUserId: 'carol', uuid: 'uuid-carol', tags: [], name: 'carol' } as never]);
        this.calls.handlePrivateEvent(
            privateEvent(this.game, this.game.botId, { $case: 'livekitInvitationMessage', livekitInvitationMessage: { token: await bot.toJwt(), serverUrl: LK_WS } }, { tags: ['bot'], uuid: 'bot-1' })
        );
        const person = new AccessToken(LK_KEY, LK_SECRET, { identity: 'carol', name: 'carol' });
        person.addGrant({ room: this.game.spaceName, roomJoin: true, canSubscribe: true, canPublish: true, canPublishSources: [GrantSource.MICROPHONE] });
        if (process.env.CHROME_LOG) await this.page.evaluate(() => ((window as never as { __lkdebug: boolean }).__lkdebug = true));
        await this.page.addScriptTag({ path: process.env.LIVEKIT_CLIENT_UMD ?? '/tmp/lkc/node_modules/livekit-client/dist/livekit-client.umd.js' });
        const jwt = await person.toJwt();
        await this.page.evaluate(([n, sp, url, token]) => (window as never as { setupLk: (a: string, b: string, c: string, d: string) => Promise<void> }).setupLk(n, sp, url, token), [this.rig.noiseB64, this.rig.speechB64, LK_WS, jwt]);
        await waitFor('the bot to be in the room', () => (this.fromWorker.some((m) => m.type === 'room.state' && (m as { state?: string }).state === 'connected') ? true : undefined), 30_000);
        // The detector's own count says when carol is heard; a worker without a detector (today's rule) has none, so it is given a few seconds
        if (this.behaviour === 'pause') await waitFor('the worker to hear carol in the room', async () => (((await this.counters()).observer_accepted_ms_room ?? 0) > 300 ? true : undefined), 30_000);
        else await sleep(6000);
    }

    /** Joins: the bot is told the person starts, the page makes its peer connection and offers. */
    async connect(): Promise<void> {
        this.calls.handlePrivateEvent(privateEvent(this.game, 'alice', { $case: 'webRtcStartMessage', webRtcStartMessage: { userId: 'alice', initiator: false } }));
        const offer = await this.page.evaluate(([n, s]) => (window as never as { setup: (a: string, b: string) => Promise<string> }).setup(n, s), [this.rig.noiseB64, this.rig.speechB64]);
        this.calls.handlePrivateEvent(privateEvent(this.game, 'alice', { $case: 'webRtcSignal', webRtcSignal: { signal: offer } }));
    }

    source(kind: string): Promise<number> {
        return this.page.evaluate((k) => (window as never as { setSource: (k: string) => number }).setSource(k), kind);
    }
    loud(): Promise<number[]> {
        return this.page.evaluate(() => (window as never as { takeLoud: () => number[] }).takeLoud());
    }
    peek(): Promise<number> {
        return this.page.evaluate(() => (window as never as { peek: () => number }).peek());
    }
    finished(id: string): (FromWorker & { at: number; interrupted?: boolean }) | undefined {
        return this.fromWorker.find((m) => m.type === 'playback.progress' && (m as { segmentId?: string }).segmentId === id && (m as { finished?: boolean }).finished) as never;
    }
}




/** Waits until the condition (sync or async) returns something truthy; throws after the timeout. The harness's own waitFor only takes a sync condition. */
export async function waitFor(what: string, condition: () => unknown, timeoutMs = 10000): Promise<void> {
    const started = Date.now();
    while (!(await condition())) {
        if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
        await sleep(20);
    }
}
export { sleep };
