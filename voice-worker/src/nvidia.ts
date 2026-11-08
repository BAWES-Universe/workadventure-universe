// Hearing and speaking with NVIDIA (#1899), as Pipecat's NvidiaSTTService and NvidiaTTSService do: Riva's gRPC services on
// NVIDIA's hosted endpoint (grpc.nvcf.nvidia.com), the key as a bearer and the model picked by NVIDIA's function-id header.
// https://build.nvidia.com/nvidia/nemotron-asr-streaming and https://build.nvidia.com/nvidia/magpie-tts-multilingual
//
// Hearing (nvidia.riva.asr.RivaSpeechRecognition/StreamingRecognize): the first message sets 16 kHz s16 audio, the language,
// punctuation and interim words; each later one holds audio. Each answer holds results, settled when is_final says so. Ending
// this side of the call ends the audio: NVIDIA sends the words it still holds, then ends the call.
//
// Speaking (nvidia.riva.tts.RivaSpeechSynthesis/SynthesizeOnline): one message with the text, the voice, its language and
// 24 kHz s16; each answer holds audio until the call ends.
//
// NVIDIA's function ids name its hosted deployment of each model and change when NVIDIA redeploys one; these are the ones
// Pipecat uses. A person's own Riva server (an address typed in Orbit) takes the same calls.
import type { RecognitionConnector, RecognitionSettings, SpeechConnector, SpeechRequest } from './connectors.ts';
import { failure } from './kit/errors.ts';
import { GrpcCall, grpcCloseStatus, GrpcSocket, pb, pbBytes, pbRead, pbUint, type GrpcEnd } from './kit/grpc.ts';
import { SPEECH_RATE } from './kit/httpSpeech.ts';
import { pcmBytes } from './kit/pcm.ts';
import { baseLanguage } from './kit/signIn.ts';
import { socketHearing, type HearingMessage } from './kit/socketHearing.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';

export const NVIDIA_ADAPTER = 'nvidia';
export const NVIDIA_ENDPOINT = 'https://grpc.nvcf.nvidia.com';
const HEARING_MODEL = 'nemotron-asr-streaming';
const SPEECH_MODEL = 'magpie-tts-multilingual';
/** NVIDIA's hosted deployment of each model, as Pipecat names them. */
export const NVIDIA_FUNCTIONS: Record<string, string> = {
    'nemotron-asr-streaming': 'bb0837de-8c7b-481f-9ec8-ef5663e9c1fa',
    'magpie-tts-multilingual': '877104f7-e885-42b9-8de8-f6e4c6303969',
};
const LINEAR_PCM = 1;

/** NVIDIA's locale for each language it hears (Pipecat's list); any other is heard as US English. */
const HEARS: Record<string, string> = {
    ar: 'ar-AR',
    de: 'de-DE',
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
    hi: 'hi-IN',
    it: 'it-IT',
    ja: 'ja-JP',
    ko: 'ko-KR',
    pt: 'pt-BR',
    ru: 'ru-RU',
};
/** The locales NVIDIA hears in more than one way: these are taken as they are. */
const HEARS_AS_IS = new Set(['en-US', 'en-GB', 'es-ES', 'es-US']);

/** The locale NVIDIA is told to hear. */
export function nvidiaHearing(language: string | undefined): string {
    if (!language) return 'en-US';
    const [base, region] = language.split(/[-_]/);
    const locale = `${base.toLowerCase()}-${(region ?? '').toUpperCase()}`;
    if (HEARS_AS_IS.has(locale)) return locale;
    return HEARS[baseLanguage(language)] ?? 'en-US';
}

/** The first Magpie voice NVIDIA's docs list for each language, used when a bot picked none. */
const DEFAULT_VOICES: Record<string, string> = {
    ar: 'Magpie-Multilingual.AR-AR.Jason',
    de: 'Magpie-Multilingual.DE-DE.Jason',
    en: 'Magpie-Multilingual.EN-US.Aria',
    es: 'Magpie-Multilingual.ES-US.Diego',
    fr: 'Magpie-Multilingual.FR-FR.Pascal',
    hi: 'Magpie-Multilingual.HI-IN.Leo',
    it: 'Magpie-Multilingual.IT-IT.Isabela',
    ja: 'Magpie-Multilingual.JA-JP.Ray',
    ko: 'Magpie-Multilingual.KO-KR.Aria',
    pt: 'Magpie-Multilingual.PT-BR.Diego',
    vi: 'Magpie-Multilingual.VI-VN.Jason',
};

/** The voice and locale a reply is spoken in: a Magpie voice names its own locale ("…EN-US.Aria" speaks en-US). */
export function nvidiaVoice(voiceId: string, language: string | undefined): { voice: string; locale: string } {
    const voice = voiceId || DEFAULT_VOICES[language ? baseLanguage(language) : 'en'] || DEFAULT_VOICES.en;
    const named = /^Magpie-[A-Za-z]+\.([A-Za-z]{2})-([A-Za-z]{2})\./.exec(voice);
    if (named) return { voice, locale: `${named[1].toLowerCase()}-${named[2].toUpperCase()}` };
    return { voice, locale: nvidiaHearing(language) };
}

const headers = (key: string, model: string, fallback: string) => ({
    authorization: `Bearer ${key}`,
    'function-id': NVIDIA_FUNCTIONS[model] ?? NVIDIA_FUNCTIONS[fallback],
});

export class NvidiaRecognition implements RecognitionConnector {
    private readonly connector: RecognitionConnector;

    constructor(options: { finalTimeoutMs?: number } = {}) {
        this.connector = socketHearing({
            adapter: NVIDIA_ADAPTER,
            endpoint: NVIDIA_ENDPOINT,
            finalTimeoutMs: options.finalTimeoutMs,
            connect: (settings: RecognitionSettings, base) => ({
                url: `${base}/nvidia.riva.asr.RivaSpeechRecognition/StreamingRecognize`,
                headers: headers(settings.key.reveal(), settings.model, HEARING_MODEL),
            }),
            transport: (address) => {
                const url = new URL(address.url);
                return new GrpcSocket({ origin: url.origin, path: url.pathname, headers: address.headers }) as never;
            },
            start: (settings: RecognitionSettings) => [
                pb.message(
                    1,
                    pb.message(
                        1,
                        pb.uint(1, LINEAR_PCM),
                        pb.uint(2, 16000),
                        pb.bytes(3, nvidiaHearing(settings.language)),
                        pb.uint(4, 1),
                        pb.uint(7, 1),
                        pb.uint(11, true),
                        // Endpointing as Pipecat sets it: 320 ms of quiet ends a phrase
                        pb.message(25, pb.uint(3, 320)),
                    ),
                    pb.uint(2, true),
                ),
            ],
            frame: (pcm16k: Int16Array) => pb.bytes(2, pcmBytes(pcm16k)),
            // The empty message ends this side of the call (src/kit/grpc.ts GrpcSocket)
            finish: () => [''],
            closeIsFinished: true,
            closed: (code) => (code === 1000 ? undefined : { error: { status: grpcCloseStatus(code) } }),
            read: (data, isBinary): HearingMessage | HearingMessage[] | undefined => {
                if (!isBinary) return undefined;
                const out: HearingMessage[] = [];
                const interim: string[] = [];
                for (const result of pbBytes(pbRead(data), 1)) {
                    const fields = pbRead(result);
                    const [best] = pbBytes(fields, 1);
                    const text = best ? (pbBytes(pbRead(best), 1)[0]?.toString('utf8') ?? '').trim() : '';
                    if (pbUint(fields, 2)) {
                        if (text) out.push({ committed: text });
                    } else if (text) interim.push(text);
                }
                out.push({ interim: interim.join(' ') });
                return out;
            },
        });
    }

    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        return this.connector.listen(settings, events);
    }
}

export class NvidiaSpeech implements SpeechConnector {
    async *speak(request: SpeechRequest): AsyncGenerator<Int16Array> {
        if (request.signal.aborted) return;
        const settings = request.settings;
        const base = (settings.endpoint || NVIDIA_ENDPOINT).replace(/\/+$/, '');
        const { voice, locale } = nvidiaVoice(settings.voiceId, request.lang || settings.language);
        const queue: (Int16Array | GrpcEnd)[] = [];
        let wake: (() => void) | undefined;
        const push = (item: Int16Array | GrpcEnd) => {
            queue.push(item);
            wake?.();
        };
        let call: GrpcCall;
        try {
            const url = new URL(base);
            call = new GrpcCall(
                {
                    origin: url.origin,
                    path: '/nvidia.riva.tts.RivaSpeechSynthesis/SynthesizeOnline',
                    headers: headers(settings.key.reveal(), settings.model, SPEECH_MODEL),
                },
                (message) => {
                    for (const audio of pbBytes(pbRead(message), 1)) {
                        // Copied so the samples line up on two bytes; an odd last byte can't be a sample
                        const even = audio.subarray(0, audio.length - (audio.length % 2));
                        if (even.length) push(new Int16Array(Uint8Array.from(even).buffer));
                    }
                },
                (end) => push(end),
            );
        } catch {
            throw failure(NVIDIA_ADAPTER, 'could not be reached');
        }
        const abort = () => call.close();
        request.signal.addEventListener('abort', abort, { once: true });
        try {
            call.send(Buffer.concat([pb.bytes(1, request.text), pb.bytes(2, locale), pb.uint(3, LINEAR_PCM), pb.uint(4, SPEECH_RATE), pb.bytes(5, voice)]));
            call.finish();
            for (;;) {
                if (request.signal.aborted) return;
                const item = queue.shift();
                if (!item) {
                    await new Promise<void>((resolve) => (wake = resolve));
                    wake = undefined;
                    continue;
                }
                if (item instanceof Int16Array) {
                    yield item;
                    continue;
                }
                if (item.ok) return;
                throw failure(NVIDIA_ADAPTER, 'answered with an error', item.status);
            }
        } finally {
            request.signal.removeEventListener('abort', abort);
            call.close();
        }
    }
}
