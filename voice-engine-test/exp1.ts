import { RTCPeerConnection, MediaStreamTrack, RtpPacket, RtpHeader, useOPUS } from 'werift';
const mk = () => new RTCPeerConnection({ codecs: { audio: [useOPUS()], video: [] }, iceUseIpv6: false, iceServers: [] });
const gathered = (pc: RTCPeerConnection) => new Promise<void>((ok) => { if (pc.iceGatheringState === 'complete') ok(); else pc.iceGatheringStateChange.subscribe((s) => s === 'complete' && ok()); });
const a = mk(), b = mk();
const track = new MediaStreamTrack({ kind: 'audio' });
const tr = a.addTransceiver(track, { direction: 'sendrecv' });
b.onTrack.subscribe((t) => { let n = 0; t.onReceiveRtp.subscribe((rtp) => { n++; if (n === 1) console.log('first rtp pt', rtp.header.payloadType, rtp.payload.length); if (n === 40) { console.log('got 40'); process.exit(0); } }); });
const offer = await a.createOffer(); await a.setLocalDescription(offer); await gathered(a);
await b.setRemoteDescription(a.localDescription!);
// b answers with sendrecv audio
const ans = await b.createAnswer(); await b.setLocalDescription(ans); await gathered(b);
await a.setRemoteDescription(b.localDescription!);
console.log('sdp offer len', a.localDescription!.sdp.length, a.localDescription!.sdp.split('\n').filter((l) => l.startsWith('a=candidate')).length, 'cands');
await new Promise<void>((ok) => { const f = () => a.connectionState === 'connected' && ok(); a.connectionStateChange.subscribe(f); f(); });
let seq = 0, ts = 0;
setInterval(() => { const h = new RtpHeader({ sequenceNumber: seq++, timestamp: ts, payloadType: 111, ssrc: 1, marker: false }); ts += 960; track.writeRtp(new RtpPacket(h, Buffer.from([0xf8, 0xff, 0xfe]))); }, 20);
setTimeout(() => { console.log('timeout'); process.exit(1); }, 8000);
