// Ultravox (game #1910), a talking model: it hears and it speaks, and the bot's own Mind writes every answer. From Ultravox's
// docs (Nov 2026):
//
// - Every stretch of speech and every reply is its own Ultravox call: made with the key (POST /api/calls, `X-API-Key`), joined
//   at the address Ultravox gives back (a server WebSocket: audio as binary frames, JSON data messages as text), and hung up
//   when done. The key only goes to Ultravox's own address, never to the call's.
// - Hearing: Ultravox can't be told to only listen, so its answers are text only (never voiced) and never heard: once Ultravox
//   writes down the person's turn (a final user transcript), the words are kept and the end of speech is said. Its own turn
//   detection ends a turn sooner than the worker's pause. A ping after the stretch says whether it still has words on the way.
// - Speaking: the Mind's words are said as they are (`forced_agent_message`), no model in between, in the picked voice, at 24 kHz.
//   The reply ends when Ultravox stops speaking.
import type { RecognitionConnector, RecognitionSettings, SpeechConnector, SpeechRequest } from './connectors.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';
import { answerStatus, failure } from './kit/errors.ts';
import { baseLanguage } from './kit/signIn.ts';
import { socketHearing, type HearingMessage } from './kit/socketHearing.ts';
import { socketSpeech, type SocketAddress, type SpeechMessage } from './kit/socketSpeech.ts';
import { LISTEN_ONLY, READ_ALOUD, TONE } from './openai.ts';

export const ULTRAVOX_ADAPTER = 'ultravox';
export const ULTRAVOX_ENDPOINT = 'https://api.ultravox.ai';
const HEARING_RATE = 16_000;
const SPEAKING_RATE = 24_000;
/** Ultravox's turn detection ends a turn after about 0.4 s of quiet: the worker's own pause is the fallback. */
const PAUSE_MS = 1_500;
/** How long a call may run at most, should its hang-up never arrive: a stretch, and a reply, are far shorter. */
const HEARING_MAX = '120s';
const SPEAKING_MAX = '300s';
/** How long making a call may take. */
const CALL_TIMEOUT_MS = 10_000;

const json = (value: unknown) => JSON.stringify(value);

/**
 * Makes one Ultravox call with the key and gives the address to join it at. The key goes in `X-API-Key` to Ultravox's own address
 * only; the call's address carries no key. A refusal comes back with Ultravox's status (401 a wrong key, 402 no credit left).
 */
export async function makeCall(key: { reveal(): string }, base: string, call: Record<string, unknown>, signal?: AbortSignal): Promise<SocketAddress> {
    const root = base.replace(/^ws(s?):\/\//i, 'http$1://').replace(/\/+$/, '');
    let response: Response;
    try {
        response = await fetch(`${root}/api/calls?enableGreetingPrompt=false`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': key.reveal() },
            body: json(call),
            redirect: 'error',
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]) : AbortSignal.timeout(CALL_TIMEOUT_MS),
        });
    } catch {
        throw failure(ULTRAVOX_ADAPTER, 'could not be reached');
    }
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw failure(ULTRAVOX_ADAPTER, 'refused the call', answerStatus(response.status, body.slice(0, 4096)));
    }
    const made = (await response.json().catch(() => null)) as { joinUrl?: unknown } | null;
    const joinUrl = typeof made?.joinUrl === 'string' ? made.joinUrl : '';
    // Only a socket address is joined: a call address that is anything else is not followed
    if (!/^wss?:\/\//i.test(joinUrl)) throw failure(ULTRAVOX_ADAPTER, 'gave no address for the call');
    return { url: joinUrl };
}

/** One data message from Ultravox (a text frame). Audio comes as binary frames. */
function readMessage(data: Buffer, isBinary: boolean): Record<string, unknown> | undefined {
    if (isBinary) return undefined;
    const value: unknown = JSON.parse(data.toString('utf8'));
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

const hangUp = () => [json({ type: 'hang_up' })];

/** Hearing with Ultravox: one call per stretch of speech, its answers text only and never heard. */
export class UltravoxRecognition implements RecognitionConnector {
    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        // The user turn being written down, by its place in the call; null when none is open
        let open: { ordinal: unknown; text: string } | null = null;
        let finishing = false;
        return socketHearing({
            adapter: ULTRAVOX_ADAPTER,
            endpoint: ULTRAVOX_ENDPOINT,
            pauseMs: PAUSE_MS,
            connect: (s, base) =>
                makeCall(s.key, base, {
                    systemPrompt: LISTEN_ONLY,
                    model: s.model,
                    ...(s.language ? { languageHint: baseLanguage(s.language) } : {}),
                    // It can't be told to only listen: what it answers is text, which nobody reads
                    initialOutputMedium: 'MESSAGE_MEDIUM_TEXT',
                    firstSpeakerSettings: { user: {} },
                    recordingEnabled: false,
                    maxDuration: HEARING_MAX,
                    medium: { serverWebSocket: { inputSampleRate: HEARING_RATE, outputSampleRate: SPEAKING_RATE } },
                }),
            // The audio goes as it is, 16 kHz s16le in binary frames (the kit's default)
            finish: () => {
                finishing = true;
                // Its answer says whether words are still on the way
                return [json({ type: 'ping', timestamp: Date.now() / 1000 })];
            },
            goodbye: hangUp,
            read: (data, isBinary): HearingMessage | HearingMessage[] | undefined => {
                const message = readMessage(data, isBinary);
                if (message?.type === 'pong') return finishing && !open ? { finished: true } : undefined;
                if (message?.type !== 'transcript' || message.role !== 'user') return undefined;
                if (!open || open.ordinal !== message.ordinal) open = { ordinal: message.ordinal, text: '' };
                // `text` is the turn so far, `delta` what is new
                if (typeof message.text === 'string') open.text = message.text;
                else if (typeof message.delta === 'string') open.text += message.delta;
                if (message.final !== true) return { interim: open.text.trim() };
                const words = open.text.trim();
                open = null;
                return [{ ...(words ? { committed: words } : {}), interim: '' }, finishing ? { finished: true } : { endpoint: true }];
            },
        }).listen(settings, events);
    }
}

/** Speaking with Ultravox: one call per reply, the Mind's words said as they are, in the picked voice. */
export class UltravoxSpeech implements SpeechConnector {
    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        // Each reply keeps its own state: it ends when Ultravox goes back to listening after speaking
        let spoke = false;
        return socketSpeech({
            adapter: ULTRAVOX_ADAPTER,
            endpoint: ULTRAVOX_ENDPOINT,
            audio: { sampleRate: SPEAKING_RATE },
            connect: (r, base) =>
                makeCall(
                    r.settings.key,
                    base,
                    {
                        // Nothing is generated: the words are said as they are. The prompt only keeps it from saying anything else
                        systemPrompt: `${READ_ALOUD} ${TONE[r.expression ?? 'natural']}`,
                        model: r.settings.model,
                        voice: r.settings.voiceId,
                        firstSpeakerSettings: { user: {} },
                        recordingEnabled: false,
                        maxDuration: SPEAKING_MAX,
                        medium: { serverWebSocket: { inputSampleRate: HEARING_RATE, outputSampleRate: SPEAKING_RATE } },
                    },
                    r.signal
                ),
            send: (r) => [json({ type: 'forced_agent_message', content: r.text, uninterruptible: true, urgency: 'immediate' })],
            goodbye: hangUp,
            // Ultravox speaks in real time, and ends a call it hangs up by closing it
            closeEndsReply: true,
            read: (data, isBinary): SpeechMessage | undefined => {
                if (isBinary) return { audio: new Uint8Array(data) };
                const message = readMessage(data, isBinary);
                if (message?.type !== 'state') return undefined;
                if (message.state === 'speaking') spoke = true;
                // Back to listening after speaking: the words are all said
                return spoke && message.state === 'listening' ? { done: true } : undefined;
            },
        }).speak(request);
    }
}
