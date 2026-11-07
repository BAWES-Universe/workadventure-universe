// Speaking with Rime (#1902), against a stand-in Rime server on loopback: no key, no network, no spend.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConnectorRegistry,
  ProviderError,
  Secret,
  type SpeechRequest,
} from "../src/connectors.ts";
import {
  RIME_ADAPTER,
  RIME_MAX_TEXT,
  RimeSpeech,
  rimeLanguage,
} from "../src/rime.ts";
import { VoiceWorker } from "../src/server.ts";

const KEY = "rime-key-640";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function fakeRime(answer: (res: http.ServerResponse) => void) {
  const seen: {
    url?: string;
    auth?: string;
    accept?: string;
    body?: Record<string, unknown>;
  }[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      seen.push({
        url: req.url,
        auth: req.headers.authorization,
        accept: req.headers.accept,
        body: raw ? JSON.parse(raw) : undefined,
      });
      answer(res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(
    () =>
      new Promise<void>(
        (resolve) => (
          server.closeAllConnections(),
          server.close(() => resolve())
        ),
      ),
  );
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    seen,
  };
}

const pcm = (...values: number[]) => Buffer.from(new Int16Array(values).buffer);

const speaking = (
  base: string,
  changes: Partial<SpeechRequest> = {},
  settings: object = {},
): SpeechRequest => ({
  text: "Marhaba.",
  settings: {
    adapter: "rime",
    model: "coda",
    voiceId: "layla",
    key: new Secret(KEY),
    endpoint: base,
    language: "ar-KW",
    ...settings,
  },
  signal: new AbortController().signal,
  ...changes,
});

async function collect(stream: AsyncIterable<Int16Array>): Promise<number[]> {
  const out: number[] = [];
  for await (const piece of stream) out.push(...piece);
  return out;
}

describe("speaking with Rime", () => {
  it("streams the text with the voice, the model and Rime's code for the language, the key as a bearer, and plays the raw audio", async () => {
    const r = await fakeRime((res) => {
      res.write(pcm(1, 2).subarray(0, 3));
      res.end(Buffer.concat([pcm(1, 2).subarray(3), pcm(3)]));
    });
    expect(await collect(new RimeSpeech().speak(speaking(r.base)))).toEqual([
      1, 2, 3,
    ]);
    expect(r.seen[0]).toEqual({
      url: "/v1/rime-tts",
      auth: `Bearer ${KEY}`,
      accept: "audio/pcm",
      body: {
        text: "Marhaba.",
        speaker: "layla",
        modelId: "coda",
        samplingRate: 24000,
        lang: "ara",
      },
    });

    await collect(
      new RimeSpeech().speak(
        speaking(
          r.base,
          { lang: "sw", text: "x".repeat(RIME_MAX_TEXT + 5) },
          { voiceId: "" },
        ),
      ),
    );
    expect(r.seen[1].body).not.toHaveProperty("speaker");
    expect(r.seen[1].body).not.toHaveProperty("lang");
    expect((r.seen[1].body?.text as string).length).toBe(RIME_MAX_TEXT);
  });

  it("names a language by the code Rime takes, and leaves one it does not speak to the voice", () => {
    expect(rimeLanguage("ar-KW")).toBe("ara");
    expect(rimeLanguage("de")).toBe("ger");
    expect(rimeLanguage("sw")).toBeUndefined();
    expect(rimeLanguage(undefined)).toBeUndefined();
  });

  it("fails with Rime's status, the key in no failure", async () => {
    const refused = await fakeRime((res) => {
      res.statusCode = 401;
      res.end('{"message":"Unauthorized"}');
    });
    const error = await collect(
      new RimeSpeech().speak(speaking(refused.base)),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).status).toBe(401);
    expect(
      `${(error as Error).message} ${JSON.stringify(error)}`,
    ).not.toContain(KEY);
  });

  it('is registered as "rime" for speaking unless a registry already brings one', () => {
    const base = {
      port: 0,
      host: "127.0.0.1",
      maxLanes: 1,
      maxSessionsPerConnection: 1,
      ice: { iceServers: [] },
    };
    expect(
      new VoiceWorker(base).connectors.speech(RIME_ADAPTER),
    ).toBeInstanceOf(RimeSpeech);
    const own = { speak: async function* () {} };
    expect(
      new VoiceWorker({
        ...base,
        connectors: new ConnectorRegistry().registerSpeech("rime", own),
      }).connectors.speech("rime"),
    ).toBe(own);
  });
});
