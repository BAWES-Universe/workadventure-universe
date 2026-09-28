/**
 * The two sounds quests make, synthesised on the spot (no asset to load): a short two-note chime when a quest is
 * done, a rising three-note one when the chapter is. Quiet, under a second, and never while the page is hidden.
 * Anything that fails (no Web Audio, the browser refusing to start audio) fails silently: sound is a garnish.
 */
type AudioContextCtor = typeof AudioContext;

let context: AudioContext | undefined;

function audioContext(): AudioContext | undefined {
    if (context) return context;
    const Ctor: AudioContextCtor | undefined =
        (window as unknown as { AudioContext?: AudioContextCtor }).AudioContext ??
        (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!Ctor) return undefined;
    context = new Ctor();
    return context;
}

/** One soft bell: a sine at `frequency` with a quick attack and a long decay, at `gain` peak. */
function bell(ctx: AudioContext, frequency: number, at: number, duration: number, gain: number): void {
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, at);
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(gain, at + 0.015);
    envelope.gain.exponentialRampToValueAtTime(0.0005, at + duration);
    oscillator.connect(envelope).connect(ctx.destination);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.05);
}

function play(notes: Array<[frequency: number, offset: number, duration: number]>, gain: number): void {
    try {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        const ctx = audioContext();
        if (!ctx) return;
        if (ctx.state === "suspended") void ctx.resume();
        const at = ctx.currentTime + 0.02;
        for (const [frequency, offset, duration] of notes) bell(ctx, frequency, at + offset, duration, gain);
    } catch {
        // No sound, no harm.
    }
}

/** A quest is done: E6 then B6, a fifth up, the classic "got it" chime. */
export function playQuestDone(): void {
    play(
        [
            [1318.5, 0, 0.5],
            [1975.5, 0.12, 0.7],
        ],
        0.12
    );
}

/** The whole chapter is done: a rising E major arpeggio. */
export function playChapterDone(): void {
    play(
        [
            [1318.5, 0, 0.5],
            [1661.2, 0.14, 0.5],
            [1975.5, 0.28, 0.6],
            [2637, 0.44, 0.9],
        ],
        0.11
    );
}
