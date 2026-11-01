// Shared fake brain ("bot server") for the voice engine test. No model, no network except the bridge socket.
// It speaks bridge v1 (../schema.json), validates every message both ways, keeps one ordered event log,
// and has a small HTTP admin API so a scenario runner can drive it.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import AjvMod from 'ajv/dist/2020.js';
import type { AnyMsg, Mode, UserTurn, PlaybackProgress, BotSay } from './protocol.ts';

const Ajv = (AjvMod as any).default ?? AjvMod;
const schema = JSON.parse(readFileSync(new URL('../schema.json', import.meta.url), 'utf8'));
const validate = new Ajv({ strict: false, allErrors: false }).compile(schema);

export interface BrainConfig {
  port: number;
  thinkMs: number;                 // delay between a final user.turn and the reply
  replyText: string;               // what the brain says after a voice turn
  greet: boolean;                  // greet when the first participant joins
  greetingText: string;
  jobResultText: string;
  quiet: boolean;
}
export const defaultConfig = (): BrainConfig => ({
  port: 8800, thinkMs: 300, replyText: 'Okay, I got that, thanks.', greet: true,
  greetingText: 'Hi there, I am the test bot. Nice to see you.', jobResultText: 'The work is finished. Here is the result.', quiet: true,
});

export interface BrainEvent { n: number; recvAt: number; dir: 'in' | 'out' | 'brain'; sessionId: string; msg: any }
interface Seg { segmentId: string; text: string; committedAt: number; sentAt: number; replyTo?: string; progress: PlaybackProgress[] }
interface Session {
  sessionId: string; ws: WebSocket; kind?: string; turnEnd?: string; participants: Map<string, number>; greeted: boolean; voice: 'active' | 'stopped';
  segs: Map<string, Seg>; pendingConfirm: Map<string, string>; jobs: Map<string, { startedAt: number; durationMs: number; done: boolean; cancelled: boolean; timer?: NodeJS.Timeout }>;
  closed: boolean; textLog: { messageId: string; participantId: string; text: string; at: number; replied: number }[]; lastStatus?: any;
}

export function startBrain(partial: Partial<BrainConfig> = {}) {
  const cfg: BrainConfig = { ...defaultConfig(), ...partial };
  const events: BrainEvent[] = [];
  const sessions = new Map<string, Session>();
  const violations: { dir: string; msg: any; errors: any }[] = [];
  let seq = 0, segCounter = 0;
  const log = (dir: BrainEvent['dir'], sessionId: string, msg: any) => { events.push({ n: ++seq, recvAt: Date.now(), dir, sessionId, msg }); };

  function send(s: Session, msg: any) {
    const full = { ts: Date.now(), sessionId: s.sessionId, ...msg };
    if (!validate(full)) { violations.push({ dir: 'out', msg: full, errors: validate.errors }); }
    log('out', s.sessionId, full);
    if (s.ws.readyState === WebSocket.OPEN) s.ws.send(JSON.stringify(full));
  }
  function say(s: Session, text: string, replyTo?: string, segmentId?: string) {
    const id = segmentId ?? `seg-${++segCounter}`;
    const seg: Seg = { segmentId: id, text, committedAt: Date.now(), sentAt: Date.now(), replyTo, progress: [] };
    s.segs.set(id, seg);
    send(s, { type: 'bot.say', segmentId: id, text, committed: true } satisfies Partial<BotSay>);
    return id;
  }

  function onMessage(s: Session, m: AnyMsg) {
    switch (m.type) {
      case 'session.start':
        s.kind = m.engine.kind; s.turnEnd = m.engine.turnEnd;
        for (const p of m.participants) s.participants.set(p.participantId, p.lane);
        break;
      case 'participant.join': {
        s.participants.set(m.participantId, m.lane);
        if (cfg.greet && !s.greeted && !m.rejoin) { s.greeted = true; say(s, cfg.greetingText, `join:${m.participantId}`); }
        break;
      }
      case 'participant.leave': s.participants.delete(m.participantId); break;
      case 'engine.status': s.lastStatus = m; if (m.voice === 'stopped') s.voice = 'stopped'; break;
      case 'playback.progress': s.segs.get(m.segmentId)?.progress.push(m); break;
      case 'user.turn': {
        const t = m as UserTurn;
        if (t.partial) break;
        const pending = s.pendingConfirm.get(t.participantId);
        if (pending) {
          s.pendingConfirm.delete(t.participantId);
          const yes = /^\s*(yes|نعم|ايوه|أيوه)/i.test(t.text);
          log('brain', s.sessionId, { type: 'confirm.answered', participantId: t.participantId, askId: pending, yes, turnId: t.turnId, text: t.text });
          setTimeout(() => s.voice === 'active' && say(s, yes ? 'Done, I will go ahead.' : 'Okay, I will not do it.', `turn:${t.turnId}`), cfg.thinkMs);
          break;
        }
        setTimeout(() => {
          if (s.closed) return;
          if (s.voice === 'active') say(s, cfg.replyText, `turn:${t.turnId}`);
          else log('brain', s.sessionId, { type: 'text_reply', replyTo: `turn:${t.turnId}`, text: cfg.replyText });
        }, cfg.thinkMs);
        break;
      }
      default: break;
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://x');
    const body = await new Promise<any>((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { ok({}); } }); });
    const json = (o: any, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (url.pathname === '/events') {
      const since = Number(url.searchParams.get('since') ?? 0); const sid = url.searchParams.get('sessionId');
      return json({ last: seq, events: events.filter((e) => e.n > since && (!sid || e.sessionId === sid)) });
    }
    if (url.pathname === '/sessions') return json([...sessions.values()].map((s) => ({ sessionId: s.sessionId, kind: s.kind, turnEnd: s.turnEnd, voice: s.voice, closed: s.closed, participants: [...s.participants.keys()] })));
    if (url.pathname === '/violations') return json({ count: violations.length, violations: violations.slice(0, 20) });
    if (url.pathname === '/config') { Object.assign(cfg, body); return json(cfg); }
    if (url.pathname === '/reset') { events.length = 0; violations.length = 0; return json({ ok: true }); }
    if (url.pathname.startsWith('/admin/')) {
      const s = sessions.get(body.sessionId);
      if (!s) return json({ error: 'no such session', sessionId: body.sessionId }, 404);
      const cmd = url.pathname.slice(7);
      if (cmd === 'mode') { send(s, { type: 'mode.set', mode: body.mode as Mode, ...(body.participantId ? { participantId: body.participantId } : {}) }); return json({ ok: true }); }
      if (cmd === 'voice_stop') { s.voice = 'stopped'; send(s, { type: 'voice.stop', reason: body.reason ?? 'allowance_ended' }); return json({ ok: true }); }
      if (cmd === 'say') { return json({ segmentId: say(s, body.text, 'admin', body.segmentId) }); }
      if (cmd === 'say_uncommitted') { // negative test: the engine must reject this. Bypasses our own validator on purpose.
        const m = { ts: Date.now(), sessionId: s.sessionId, type: 'bot.say', segmentId: body.segmentId ?? `seg-${++segCounter}`, text: body.text, committed: false };
        log('out', s.sessionId, m); s.ws.send(JSON.stringify(m)); s.segs.set(m.segmentId, { segmentId: m.segmentId, text: m.text, committedAt: 0, sentAt: Date.now(), progress: [] }); return json({ segmentId: m.segmentId });
      }
      if (cmd === 'retract') { send(s, { type: 'bot.retract', segmentId: body.segmentId }); return json({ ok: true }); }
      if (cmd === 'ask') { const id = say(s, body.text, 'ask'); s.pendingConfirm.set(body.participantId, id); log('brain', s.sessionId, { type: 'confirm.pending', participantId: body.participantId, askId: id }); return json({ segmentId: id }); }
      if (cmd === 'chat') { // a typed message arrives from the chat path
        const messageId = body.messageId ?? `m-${++seq}`;
        const m = { type: 'user.text', sessionId: s.sessionId, participantId: body.participantId, text: body.text, messageId, ts: Date.now() };
        if (!validate(m)) violations.push({ dir: 'chat', msg: m, errors: validate.errors });
        log('in', s.sessionId, m);
        const rec = { messageId, participantId: body.participantId, text: body.text, at: Date.now(), replied: 0 }; s.textLog.push(rec);
        setTimeout(() => {
          rec.replied++;
          if (s.voice === 'active') say(s, `You typed: ${body.text}`, `text:${messageId}`);
          else log('brain', s.sessionId, { type: 'text_reply', replyTo: `text:${messageId}`, text: `You typed: ${body.text}` });
        }, cfg.thinkMs);
        return json({ messageId });
      }
      if (cmd === 'job') { // a durable job that nothing in the voice path may cancel
        const jobId = body.jobId ?? `job-${++seq}`;
        const job = { startedAt: Date.now(), durationMs: body.durationMs ?? 6000, done: false, cancelled: false } as Session['jobs'] extends Map<any, infer V> ? V : never;
        s.jobs.set(jobId, job);
        log('brain', s.sessionId, { type: 'job.started', jobId, durationMs: job.durationMs });
        say(s, body.ackText ?? "On it, I'm starting that work for you now.", `job:${jobId}`);
        job.timer = setTimeout(() => {
          job.done = true;
          log('brain', s.sessionId, { type: 'job.finished', jobId, cancelled: job.cancelled });
          if (s.voice === 'active' && !s.closed) say(s, cfg.jobResultText, `job-result:${jobId}`);
        }, job.durationMs);
        return json({ jobId });
      }
      if (cmd === 'end') { send(s, { type: 'session.end' }); return json({ ok: true }); }
      return json({ error: 'unknown admin command' }, 400);
    }
    if (url.pathname === '/segments') { // committed text vs progress, per segment
      const s = sessions.get(url.searchParams.get('sessionId') ?? '');
      return json(s ? [...s.segs.values()].map((g) => ({ segmentId: g.segmentId, text: g.text, replyTo: g.replyTo, sentAt: g.sentAt, progress: g.progress })) : []);
    }
    json({ ok: true, sessions: sessions.size, events: seq });
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, sock, head) => {
    if (!req.url?.startsWith('/bridge')) { sock.destroy(); return; }
    wss.handleUpgrade(req, sock, head, (ws) => {
      let s: Session | undefined;
      ws.on('message', (data) => {
        let m: any;
        try { m = JSON.parse(String(data)); } catch { violations.push({ dir: 'in', msg: String(data).slice(0, 200), errors: 'not json' }); return; }
        if (!validate(m)) { violations.push({ dir: 'in', msg: m, errors: validate.errors }); }
        if (m.type === 'session.start') {
          s = sessions.get(m.sessionId);
          if (s && !s.closed) { try { s.ws.close(); } catch { /* old socket */ } s.ws = ws; }
          else { s = { sessionId: m.sessionId, ws, participants: new Map(), greeted: false, voice: 'active', segs: new Map(), pendingConfirm: new Map(), jobs: new Map(), closed: false, textLog: [] }; sessions.set(m.sessionId, s); }
        }
        if (!s) { violations.push({ dir: 'in', msg: m, errors: 'first message was not session.start' }); return; }
        log('in', s.sessionId, m);
        onMessage(s, m);
      });
      ws.on('close', () => { if (s && s.ws === ws) { s.closed = true; log('brain', s.sessionId, { type: 'bridge.closed' }); } });
      ws.on('error', () => {});
    });
  });
  const ready = new Promise<void>((ok) => server.listen(cfg.port, '127.0.0.1', ok));
  return { cfg, ready, events, sessions, violations, close: async () => { for (const s of sessions.values()) for (const j of s.jobs.values()) if (j.timer) clearTimeout(j.timer); wss.close(); server.closeAllConnections(); await new Promise((r) => server.close(r as any)); } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.BRAIN_PORT ?? 8800);
  const b = startBrain({ port, thinkMs: Number(process.env.BRAIN_THINK_MS ?? 300) });
  b.ready.then(() => console.log(`fake brain on :${port}`));
  const stop = async () => { await b.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
