// Tiny local signaling server shared by both engines. Non-trickle: the offer and answer SDP carry all ICE candidates.
//   engine  --WS /engine-->  registers, receives {type:'offer'|'fake.clip'|'hangup'}, replies {type:'answer'|'error'}
//   client  --HTTP-->        POST /offer {sessionId,bubbleId,participantId,sdp}  ->  {sdp,type,lane}
//                            POST /hint  {sessionId,participantId,clipId}        (test-only fake STT side channel)
//                            POST /hangup {sessionId,participantId}
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

export function startSignaling(port = 8700) {
  let engine: WebSocket | undefined; let engineHello: any;
  const pending = new Map<string, { ok: (v: any) => void; fail: (e: Error) => void; t: NodeJS.Timeout }>();
  const lanes = new Map<string, Map<string, number>>(); // sessionId -> participantId -> lane
  let reqSeq = 0;

  const server = http.createServer(async (req, res) => {
    const body = await new Promise<any>((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { ok({}); } }); });
    const json = (o: any, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/offer' && req.method === 'POST') {
      if (!engine || engine.readyState !== WebSocket.OPEN) return json({ error: 'no engine registered' }, 503);
      let m = lanes.get(body.sessionId); if (!m) lanes.set(body.sessionId, (m = new Map()));
      if (!m.has(body.participantId)) m.set(body.participantId, m.size);
      const lane = m.get(body.participantId)!;
      const reqId = `r${++reqSeq}`;
      const p = new Promise<any>((ok, fail) => { const t = setTimeout(() => { pending.delete(reqId); fail(new Error('engine did not answer in 15 s')); }, 15000); pending.set(reqId, { ok, fail, t }); });
      engine.send(JSON.stringify({ type: 'offer', reqId, lane, ...body }));
      try { const a = await p; return json({ ...a, lane }); } catch (e: any) { return json({ error: String(e.message) }, 500); }
    }
    if (req.url === '/hint' && req.method === 'POST') { engine?.send(JSON.stringify({ type: 'fake.clip', ...body })); return json({ ok: true }); }
    if (req.url === '/hangup' && req.method === 'POST') { engine?.send(JSON.stringify({ type: 'hangup', ...body })); return json({ ok: true }); }
    if (req.url === '/engine-info') return json({ connected: !!engine && engine.readyState === WebSocket.OPEN, hello: engineHello });
    json({ ok: true });
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, sock, head) => {
    if (req.url !== '/engine') { sock.destroy(); return; }
    wss.handleUpgrade(req, sock, head, (ws) => {
      engine = ws;
      ws.on('message', (d) => {
        const m = JSON.parse(String(d));
        if (m.type === 'engine.hello') { engineHello = m; return; }
        const p = pending.get(m.reqId); if (!p) return;
        clearTimeout(p.t); pending.delete(m.reqId);
        if (m.type === 'answer') p.ok({ sdp: m.sdp, type: 'answer' }); else p.fail(new Error(m.message ?? 'engine error'));
      });
      ws.on('close', () => { if (engine === ws) { engine = undefined; engineHello = undefined; } });
    });
  });
  const ready = new Promise<void>((ok) => server.listen(port, '127.0.0.1', ok));
  return { ready, close: async () => { wss.close(); server.closeAllConnections(); await new Promise((r) => server.close(r as any)); } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.SIGNALING_PORT ?? 8700);
  const s = startSignaling(port); s.ready.then(() => console.log(`signaling on :${port}`));
  const stop = async () => { await s.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
