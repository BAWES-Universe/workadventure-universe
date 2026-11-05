// An offer shaped like the ones browsers make (audio with several codecs, video, a data channel), to see that the
// worker answers it with audio only and keeps the browser's own numbers for the audio codec.
import { afterEach, expect, it } from 'vitest';
import { type Rig, startRig, waitFor } from './harness.ts';

const FINGERPRINT = Array.from({ length: 32 }, (_, i) => (i * 7 + 3).toString(16).padStart(2, '0').toUpperCase()).join(':');

const BROWSER_OFFER = [
    'v=0',
    'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0 1 2',
    'a=extmap-allow-mixed',
    'a=msid-semantic: WMS stream1',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126',
    'c=IN IP4 0.0.0.0',
    'a=rtcp:9 IN IP4 0.0.0.0',
    'a=ice-ufrag:abcd',
    'a=ice-pwd:aaaaaaaaaaaaaaaaaaaaaaaa',
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${FINGERPRINT}`,
    'a=setup:actpass',
    'a=mid:0',
    'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level',
    'a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time',
    'a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid',
    'a=sendrecv',
    'a=msid:stream1 track1',
    'a=rtcp-mux',
    'a=rtpmap:111 opus/48000/2',
    'a=rtcp-fb:111 transport-cc',
    'a=fmtp:111 minptime=10;useinbandfec=1',
    'a=rtpmap:63 red/48000/2',
    'a=fmtp:63 111/111',
    'a=rtpmap:9 G722/8000',
    'a=rtpmap:0 PCMU/8000',
    'a=rtpmap:8 PCMA/8000',
    'a=rtpmap:13 CN/8000',
    'a=rtpmap:110 telephone-event/48000',
    'a=rtpmap:126 telephone-event/8000',
    'a=ssrc:1234 cname:xyz',
    'a=ssrc:1234 msid:stream1 track1',
    'm=video 9 UDP/TLS/RTP/SAVPF 96 97',
    'c=IN IP4 0.0.0.0',
    'a=rtcp:9 IN IP4 0.0.0.0',
    'a=ice-ufrag:abcd',
    'a=ice-pwd:aaaaaaaaaaaaaaaaaaaaaaaa',
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${FINGERPRINT}`,
    'a=setup:actpass',
    'a=mid:1',
    'a=sendrecv',
    'a=msid:stream1 track2',
    'a=rtcp-mux',
    'a=rtcp-rsize',
    'a=rtpmap:96 VP8/90000',
    'a=rtcp-fb:96 goog-remb',
    'a=rtcp-fb:96 nack',
    'a=rtcp-fb:96 nack pli',
    'a=rtpmap:97 rtx/90000',
    'a=fmtp:97 apt=96',
    'a=ssrc-group:FID 5678 5679',
    'a=ssrc:5678 cname:xyz',
    'a=ssrc:5679 cname:xyz',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    'a=ice-ufrag:abcd',
    'a=ice-pwd:aaaaaaaaaaaaaaaaaaaaaaaa',
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${FINGERPRINT}`,
    'a=setup:actpass',
    'a=mid:2',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    '',
].join('\r\n');

let rig: Rig;
afterEach(async () => {
    rig?.calls.shutdown();
    await rig?.worker.close();
});

it('answers a browser-shaped offer with audio only, in the browser\'s codec numbers, naming a stream for the track', async () => {
    rig = await startRig();
    rig.link().send({ type: 'session.open', sessionId: 's1', bubbleId: 'b', botId: 'bot1' });
    rig.link().send({ type: 'lane.open', sessionId: 's1', participantId: 'alice', epoch: 1 });
    rig.link().send({ type: 'lane.signal', sessionId: 's1', participantId: 'alice', epoch: 1, signal: { type: 'offer', sdp: BROWSER_OFFER } });
    await waitFor('an answer', () => rig.fromWorker.some((m) => m.type === 'lane.signal'));
    const answer = (rig.fromWorker.find((m) => m.type === 'lane.signal') as { signal: { type: string; sdp: string } }).signal;

    expect(answer.type).toBe('answer');
    const sdp = answer.sdp;
    expect(sdp).toMatch(/m=audio [1-9]\d* UDP\/TLS\/RTP\/SAVPF 111\r?\n/);
    expect(sdp).toMatch(/a=rtpmap:111 opus\/48000\/2/i);
    expect(sdp).toMatch(/m=video 0 /);
    expect(sdp).toMatch(/a=msid:bot-/);
    expect(sdp).toMatch(/a=sendrecv/);
    expect(sdp).toMatch(/m=application [1-9]\d* UDP\/DTLS\/SCTP webrtc-datachannel/);
    expect(rig.violations).toEqual([]);
});
