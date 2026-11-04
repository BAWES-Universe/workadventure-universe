/**
 * A song or sound a bot sends needs a file name with an ending: the chat card tells an audio file by it
 * (the "Open in player" row, the "· MP3" label). A link with no ending, or no name, gets one from the file's type.
 */
const AUDIO_ENDINGS = new Set(['mp3', 'm4a', 'wav', 'ogg', 'oga', 'opus', 'aac', 'flac', 'weba']);

const ENDING_BY_MIME: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/aac': 'aac',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'audio/webm': 'weba',
};

function endingOf(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function lastPartOfLink(link: string): string {
    const last = link.split(/[?#]/)[0].split('/').pop() ?? '';
    try {
        return decodeURIComponent(last);
    } catch {
        return last;
    }
}

/**
 * The name to send an audio file under: the one it has when that ends as audio, else "song" with the ending its
 * type gives. Undefined when neither the name nor the type says it is audio, so the card falls back to the link.
 */
export function audioFileNameFor(link: string, mimeType?: string, given?: string): string | undefined {
    const name = (given?.trim() || lastPartOfLink(link)).trim();
    if (AUDIO_ENDINGS.has(endingOf(name))) return name;
    const ending = ENDING_BY_MIME[(mimeType ?? '').split(';')[0].trim().toLowerCase()];
    if (!ending) return undefined;
    // A name a person gave keeps its words; a link's last part (an id) does not.
    return given?.trim() ? `${given.trim()}.${ending}` : `song.${ending}`;
}
