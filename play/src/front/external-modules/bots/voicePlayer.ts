// The bot page's voice samples (#1668): one sample plays at a time, and tapping the one that plays stops it. A sample is
// the voice company's own free one; it never speaks the bot's words.
import { writable } from "svelte/store";

/** What plays now: "card" for the voice on the card, "row:<voiceId>" for a row of the picker, "" for nothing. */
export const playingSample = writable("");

let audio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
let turn = 0;

function release() {
    if (audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio = null;
    }
    if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
    }
}

export function stopSample() {
    turn++;
    release();
    playingSample.set("");
}

/**
 * Plays the sample `load` gives the address of, or stops it when it is the one playing. `onFailed` is told when the
 * sample can't be fetched or played.
 */
export async function toggleSample(
    id: string,
    load: () => Promise<{ url: string; revoke?: boolean }>,
    onFailed: () => void
): Promise<void> {
    let playing = "";
    const unsubscribe = playingSample.subscribe((value) => (playing = value));
    unsubscribe();
    if (playing === id) {
        stopSample();
        return;
    }
    stopSample();
    const mine = turn;
    playingSample.set(id);
    try {
        const source = await load();
        if (mine !== turn) {
            if (source.revoke) URL.revokeObjectURL(source.url);
            return;
        }
        if (source.revoke) objectUrl = source.url;
        const next = new Audio(source.url);
        audio = next;
        const failed = () => {
            if (mine !== turn) return;
            stopSample();
            onFailed();
        };
        next.onended = () => {
            if (mine === turn) stopSample();
        };
        next.onerror = failed;
        await next.play().catch(failed);
    } catch {
        if (mine !== turn) return;
        stopSample();
        onFailed();
    }
}
