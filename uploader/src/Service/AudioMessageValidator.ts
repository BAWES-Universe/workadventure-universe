/**
 * Checks applied to files sent to /upload-audio-message. Audio messages are
 * broadcast to every player of a room or world, so only real audio files are
 * accepted and they are always served back with an audio Content-Type.
 */

export const AUDIO_MESSAGE_MAX_FILE_SIZE = 10 * 1024 * 1024;

// The Content-Type is chosen from the extension, never from what the client sent.
const AUDIO_CONTENT_TYPES = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  webm: "audio/webm",
  flac: "audio/flac",
} as const;

export type AudioExtension = keyof typeof AUDIO_CONTENT_TYPES;

export const AUDIO_EXTENSIONS = Object.keys(
  AUDIO_CONTENT_TYPES
) as AudioExtension[];

export const AUDIO_MESSAGE_ID_REGEX = new RegExp(
  `^[0-9a-f-]{36}\\.(${AUDIO_EXTENSIONS.join("|")})$`
);

// Browsers derive the MIME type of a picked file from its extension, and some
// of them report these containers as video even when they only hold audio.
const EXTRA_MIME_TYPES: Partial<Record<AudioExtension, string[]>> = {
  webm: ["video/webm"],
  ogg: ["video/ogg", "application/ogg"],
};

export function getAudioExtension(
  fileName: string
): AudioExtension | undefined {
  const dot = fileName.lastIndexOf(".");
  if (dot === -1) {
    return undefined;
  }
  const extension = fileName.substring(dot + 1).toLowerCase();
  return (AUDIO_EXTENSIONS as string[]).includes(extension)
    ? (extension as AudioExtension)
    : undefined;
}

export function getAudioContentType(extension: AudioExtension): string {
  return AUDIO_CONTENT_TYPES[extension];
}

export function isAllowedAudioMimeType(
  extension: AudioExtension,
  mimeType: string
): boolean {
  const normalized = mimeType.split(";")[0].trim().toLowerCase();
  return (
    normalized.startsWith("audio/") ||
    (EXTRA_MIME_TYPES[extension] ?? []).includes(normalized)
  );
}

function startsWithAscii(buffer: Buffer, text: string, offset = 0): boolean {
  return (
    buffer.length >= offset + text.length &&
    buffer.toString("latin1", offset, offset + text.length) === text
  );
}

// MPEG audio frame header: 11 sync bits, then no reserved version, layer,
// bitrate or sample rate value.
function isMpegFrameHeader(buffer: Buffer): boolean {
  if (buffer.length < 4 || buffer[0] !== 0xff || (buffer[1] & 0xe0) !== 0xe0) {
    return false;
  }
  const version = (buffer[1] >> 3) & 0x03;
  const layer = (buffer[1] >> 1) & 0x03;
  const bitrate = buffer[2] >> 4;
  const sampleRate = (buffer[2] >> 2) & 0x03;
  return (
    version !== 0x01 &&
    layer !== 0x00 &&
    bitrate !== 0x0f &&
    sampleRate !== 0x03
  );
}

// AAC ADTS header: 12 sync bits, layer 0, then a known sampling frequency index.
function isAdtsHeader(buffer: Buffer): boolean {
  if (buffer.length < 4 || buffer[0] !== 0xff || (buffer[1] & 0xf6) !== 0xf0) {
    return false;
  }
  const samplingIndex = (buffer[2] >> 2) & 0x0f;
  return samplingIndex < 13;
}

export function hasAudioSignature(
  extension: AudioExtension,
  buffer: Buffer
): boolean {
  switch (extension) {
    case "mp3":
      return startsWithAscii(buffer, "ID3") || isMpegFrameHeader(buffer);
    case "aac":
      return startsWithAscii(buffer, "ID3") || isAdtsHeader(buffer);
    case "wav":
      return (
        startsWithAscii(buffer, "RIFF") && startsWithAscii(buffer, "WAVE", 8)
      );
    case "ogg":
    case "oga":
    case "opus":
      return startsWithAscii(buffer, "OggS");
    case "flac":
      return startsWithAscii(buffer, "fLaC");
    case "m4a":
      return startsWithAscii(buffer, "ftyp", 4);
    case "webm":
      return (
        buffer.length >= 4 &&
        buffer[0] === 0x1a &&
        buffer[1] === 0x45 &&
        buffer[2] === 0xdf &&
        buffer[3] === 0xa3
      );
    default: {
      const unreachable: never = extension;
      return unreachable;
    }
  }
}

/**
 * Returns the extension to store the file under, or undefined when the file
 * is not an accepted audio file (name, declared type and content must agree).
 */
export function validateAudioMessage(
  fileName: string,
  mimeType: string,
  buffer: Buffer
): AudioExtension | undefined {
  const extension = getAudioExtension(fileName);
  if (
    extension === undefined ||
    !isAllowedAudioMimeType(extension, mimeType) ||
    !hasAudioSignature(extension, buffer)
  ) {
    return undefined;
  }
  return extension;
}
