import { describe, expect, it } from "@jest/globals";
import {
  AUDIO_MESSAGE_ID_REGEX,
  getAudioContentType,
  hasAudioSignature,
  validateAudioMessage,
} from "../src/Service/AudioMessageValidator";

const bytes = (...values: number[]) => Buffer.from(values);
const ascii = (text: string) => Buffer.from(text, "latin1");

const SAMPLES = {
  mp3Id3: Buffer.concat([ascii("ID3"), bytes(4, 0, 0, 0, 0, 0, 0)]),
  // MPEG-1 Layer III, 128 kbit/s, 44.1 kHz
  mp3Frame: bytes(0xff, 0xfb, 0x90, 0x64, 0, 0),
  // AAC ADTS, 44.1 kHz
  aac: bytes(0xff, 0xf1, 0x50, 0x80, 0, 0),
  wav: Buffer.concat([ascii("RIFF"), bytes(0x24, 0, 0, 0), ascii("WAVEfmt ")]),
  ogg: Buffer.concat([ascii("OggS"), bytes(0, 2, 0, 0)]),
  flac: Buffer.concat([ascii("fLaC"), bytes(0, 0, 0, 0x22)]),
  m4a: Buffer.concat([bytes(0, 0, 0, 0x20), ascii("ftypM4A ")]),
  webm: bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42),
};

describe("validateAudioMessage", () => {
  it.each([
    ["song.mp3", "audio/mpeg", SAMPLES.mp3Id3, "mp3"],
    ["song.MP3", "audio/mp3", SAMPLES.mp3Frame, "mp3"],
    ["song.aac", "audio/aac", SAMPLES.aac, "aac"],
    ["voice.wav", "audio/wav", SAMPLES.wav, "wav"],
    ["voice.wav", "audio/x-wav", SAMPLES.wav, "wav"],
    ["voice.ogg", "audio/ogg", SAMPLES.ogg, "ogg"],
    ["voice.ogg", "video/ogg", SAMPLES.ogg, "ogg"],
    ["voice.oga", "audio/ogg", SAMPLES.ogg, "oga"],
    ["voice.opus", "audio/opus", SAMPLES.ogg, "opus"],
    ["voice.flac", "audio/flac", SAMPLES.flac, "flac"],
    ["voice.m4a", "audio/x-m4a", SAMPLES.m4a, "m4a"],
    ["voice.webm", "audio/webm", SAMPLES.webm, "webm"],
    ["voice.webm", "video/webm", SAMPLES.webm, "webm"],
  ])("accepts %s sent as %s", (name, mimeType, buffer, extension) => {
    expect(validateAudioMessage(name, mimeType, buffer)).toEqual(extension);
  });

  it.each([
    ["page.html", "text/html", ascii("<html><body>hi</body></html>")],
    [
      "image.svg",
      "image/svg+xml",
      ascii("<svg xmlns='http://www.w3.org/2000/svg'/>"),
    ],
    ["notes.txt", "text/plain", ascii("hello")],
    ["no-extension", "audio/mpeg", SAMPLES.mp3Id3],
    // audio name and type, but not audio content
    ["song.mp3", "audio/mpeg", ascii("<html><script>alert(1)</script></html>")],
    ["song.mp3", "audio/mpeg", ascii("<svg onload=alert(1)>")],
    // UTF-16 text starts with 0xFF 0xFE, which looks like an MPEG sync word
    ["song.mp3", "audio/mpeg", Buffer.from("﻿<html>", "utf16le")],
    ["song.mp3", "audio/mpeg", Buffer.alloc(0)],
    // audio content, but a type that is not audio
    ["song.mp3", "text/html", SAMPLES.mp3Id3],
    ["voice.wav", "application/octet-stream", SAMPLES.wav],
    ["voice.m4a", "video/webm", SAMPLES.m4a],
    // content of another audio format than the extension
    ["voice.wav", "audio/wav", SAMPLES.ogg],
    ["voice.webm", "audio/webm", SAMPLES.wav],
  ])("rejects %s sent as %s", (name, mimeType, buffer) => {
    expect(validateAudioMessage(name, mimeType, buffer)).toBeUndefined();
  });

  it("rejects a RIFF file that is not WAVE", () => {
    const avi = Buffer.concat([
      ascii("RIFF"),
      bytes(0, 0, 0, 0),
      ascii("AVI LIST"),
    ]);
    expect(hasAudioSignature("wav", avi)).toBe(false);
  });
});

describe("audio message ids", () => {
  it("only matches generated ids", () => {
    expect(
      AUDIO_MESSAGE_ID_REGEX.test("0b5a8f4e-5a2b-4c1d-9e3f-1234567890ab.mp3")
    ).toBe(true);
    expect(
      AUDIO_MESSAGE_ID_REGEX.test("0b5a8f4e-5a2b-4c1d-9e3f-1234567890ab.webm")
    ).toBe(true);
    expect(
      AUDIO_MESSAGE_ID_REGEX.test("0b5a8f4e-5a2b-4c1d-9e3f-1234567890ab")
    ).toBe(false);
    expect(
      AUDIO_MESSAGE_ID_REGEX.test("0b5a8f4e-5a2b-4c1d-9e3f-1234567890ab.html")
    ).toBe(false);
    expect(
      AUDIO_MESSAGE_ID_REGEX.test("0b5a8f4e-5a2b-4c1d-9e3f-1234567890ab.txt")
    ).toBe(false);
    expect(AUDIO_MESSAGE_ID_REGEX.test("some-redis-key")).toBe(false);
    expect(AUDIO_MESSAGE_ID_REGEX.test("x.mp3")).toBe(false);
  });

  it("serves an audio content type for every extension", () => {
    for (const extension of [
      "mp3",
      "wav",
      "ogg",
      "oga",
      "opus",
      "m4a",
      "aac",
      "webm",
      "flac",
    ] as const) {
      expect(getAudioContentType(extension)).toMatch(/^audio\//);
    }
  });
});
