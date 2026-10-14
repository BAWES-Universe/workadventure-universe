import type { Emitter } from "./NativeSoundscape";

/** One native music channel, with at most two media elements during a source change. */
export interface AudioSource {
    url: string;
    volume: number;
    loop: boolean;
    /** Explicit opt-in only; ignored by the unchanged legacy playback implementation. */
    soundscape?: Emitter;
}

export interface AudioControls {
    volume: number;
    muted: boolean;
    paused: boolean;
    stopped: boolean;
    talking: boolean;
    decreaseWhileTalking: boolean;
}

type PlayerState = "loading" | "playing" | "not_allowed" | "error" | undefined;

type Slot = {
    media: HTMLAudioElement;
    source: AudioSource;
    envelope: number;
    attempt: number;
    pending: boolean;
    ended: boolean;
    // Set once play() has resolved for this load; cleared when a failed load is retried.
    confirmed: boolean;
    failed: "not_allowed" | "error" | undefined;
    // Set when the element is routed through Web Audio because the browser ignores element volume.
    graph: GainNode | undefined;
};

function createBrowserContext(): AudioContext | undefined {
    if (typeof window === "undefined") return undefined;
    const Context =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    return Context ? new Context() : undefined;
}

/** True when the host sends CORS headers (what Web Audio needs). Stops at the headers; the body is not downloaded. */
async function hostAllowsCors(url: string): Promise<boolean> {
    if (typeof fetch !== "function") return true;
    const controller = new AbortController();
    try {
        await fetch(url, { mode: "cors", credentials: "omit", signal: controller.signal });
        return true;
    } catch {
        return false;
    } finally {
        controller.abort();
    }
}

function originOf(url: string): string {
    try {
        return new URL(url, window.location.href).origin;
    } catch {
        return url;
    }
}

export function clampAudioVolume(volume: number | undefined): number {
    return volume === undefined || !Number.isFinite(volume) ? 1 : Math.max(0, Math.min(1, volume));
}

export class AudioPlayback {
    private current: Slot | undefined;
    private outgoing: Slot | undefined;
    private fadeTimer: ReturnType<typeof setTimeout> | undefined;
    private volumeSupported: boolean | undefined;
    // iOS Safari ignores element volume, so there the level is set with a Web Audio gain node instead.
    private context: AudioContext | undefined;
    private contextBlocked = false;
    private readonly gains = new WeakMap<HTMLAudioElement, GainNode>();
    // Web Audio needs CORS. false = this origin plays through a plain element (hardware volume only, as
    // before); it is asked again on every track, so a dropped connection only costs volume control briefly.
    private readonly originCors = new Map<string, boolean>();
    private readonly probingOrigins = new Set<string>();
    private swapping = false;
    // URLs that failed in CORS mode and are being tried plain. If the plain load plays, the cause was CORS.
    private readonly plainRetryUrls = new Set<string>();
    // Reuse media elements: some browsers grant autoplay permission per element.
    private readonly idleMedia: HTMLAudioElement[] = [];
    private destroyed = false;
    private controls: AudioControls = {
        volume: 1,
        muted: false,
        paused: false,
        stopped: false,
        talking: false,
        decreaseWhileTalking: true,
    };

    constructor(
        private readonly onState: (state: PlayerState) => void,
        private readonly onEnded: () => void,
        private readonly createAudio: () => HTMLAudioElement = () => new Audio(),
        private readonly duration = 1600,
        private readonly audioContainer?: HTMLElement,
        private readonly createContext: () => AudioContext | undefined = createBrowserContext,
        private readonly checkCors: (url: string) => Promise<boolean> = hostAllowsCors
    ) {}

    setSource(source: AudioSource | undefined): void {
        if (this.destroyed) return;
        if (source && this.current?.source.url === source.url) {
            this.current.source = { ...source, volume: clampAudioVolume(source.volume) };
            this.applyVolumes();
            return;
        }
        this.cancelFade();
        const returning = this.outgoing;
        if (source && returning?.source.url === source.url && this.isAudible(returning)) {
            // Back to the source that is still fading out: fade it up from where it is
            // instead of restarting it from the beginning.
            const leaving = this.current;
            this.outgoing = leaving && this.isAudible(leaving) ? leaving : undefined;
            if (leaving && this.outgoing !== leaving) this.release(leaving);
            returning.source = { ...source, volume: clampAudioVolume(source.volume) };
            this.current = returning;
            this.startFade();
            this.onState("playing");
            return;
        }
        // An interrupted fade may have a silent incoming slot. Retain the more audible
        // viable track rather than replacing an established bed with that silent target.
        const candidates = [this.current, this.outgoing].filter((slot): slot is Slot => !!slot && this.isAudible(slot));
        const retained = candidates.sort((a, b) => b.envelope * b.source.volume - a.envelope * a.source.volume)[0];
        if (this.current !== retained) this.release(this.current);
        if (this.outgoing !== retained) this.release(this.outgoing);
        this.outgoing = retained;
        this.current = undefined;
        if (!source) {
            this.release(this.outgoing);
            this.outgoing = undefined;
            this.onState(undefined);
            return;
        }
        let media = this.idleMedia.pop() ?? this.createAudio();
        this.detectVolumeSupport(media);
        const useGraph =
            this.volumeSupported === false &&
            this.originCors.get(originOf(source.url)) !== false &&
            !this.plainRetryUrls.has(source.url);
        if (!useGraph && this.gains.has(media)) {
            // A graph-bound element cannot go back to plain playback. Reuse an idle plain element (it may
            // already be unlocked for playback) and only create a new one when there is none.
            const plain = this.idleMedia.findIndex((idle) => !this.gains.has(idle));
            this.idleMedia.push(media);
            media = plain >= 0 ? this.idleMedia.splice(plain, 1)[0] : this.createAudio();
        }
        const graph = useGraph ? this.attachGraph(media) : undefined;
        if (this.audioContainer) {
            media.classList.add("audio-manager-audioplayer");
            this.audioContainer.append(media);
        }
        const slot: Slot = {
            media,
            source: { ...source, volume: clampAudioVolume(source.volume) },
            envelope: this.outgoing ? 0 : 1,
            attempt: 0,
            pending: false,
            ended: false,
            confirmed: false,
            failed: undefined,
            graph,
        };
        this.current = slot;
        if (this.volumeSupported === false && !this.swapping) this.probeCors(source.url);
        media.preload = "auto";
        media.onended = () => {
            if (this.current !== slot) return;
            slot.ended = true;
            this.cancelFade();
            this.release(this.outgoing);
            this.outgoing = undefined;
            this.onState(undefined);
            this.onEnded();
        };
        media.onerror = () => {
            if (this.current !== slot) return;
            console.warn("AudioPlayback: media error", media.error?.code, media.error?.message);
            // Firefox can report an error on a file it is already playing; the old player only logged it and kept
            // playing. So an error after playback was confirmed fails the slot only if the element has stopped.
            if (slot.confirmed && !media.paused) return;
            this.fail(slot, "error");
        };
        this.applyVolumes();
        media.src = source.url;
        media.load();
        this.playCurrent();
    }

    setControls(controls: AudioControls): void {
        const wasSuspended = !this.canPlay();
        this.controls = { ...controls, volume: clampAudioVolume(controls.volume) };
        this.applyVolumes();
        if (!this.canPlay()) {
            this.suspend();
        } else if (wasSuspended) {
            this.playCurrent();
        }
    }

    /** Called synchronously in the native user gesture handler for autoplay recovery. */
    retry(): void {
        // Safari starts a Web Audio context only from a gesture, so resume it in the same call stack.
        this.resumeContext();
        if (this.current) {
            // A resource error needs a fresh media load. Autoplay recovery must remain
            // in the original gesture and must not reset an otherwise healthy source.
            if (this.current.failed === "error") {
                this.current.media.load();
                this.current.confirmed = false;
            }
            this.current.failed = undefined;
        }
        this.playCurrent();
    }

    destroy(): void {
        this.destroyed = true;
        this.cancelFade();
        this.release(this.current);
        this.release(this.outgoing);
        this.current = this.outgoing = undefined;
        this.idleMedia.length = 0;
        if (this.context) {
            this.context.onstatechange = null;
            if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisible);
            void this.context.close().catch(() => undefined);
            this.context = undefined;
        }
        this.onState(undefined);
    }

    private canPlay(): boolean {
        return !this.destroyed && !this.controls.paused && !this.controls.stopped;
    }

    private isAudible(slot: Slot): boolean {
        return this.canPlay() && !slot.media.paused && !slot.pending && !slot.failed && !slot.ended;
    }

    private suspend(): void {
        this.cancelFade();
        this.release(this.outgoing);
        this.outgoing = undefined;
        if (this.current) {
            this.current.attempt++;
            this.current.pending = false;
            this.current.media.pause();
        }
    }

    private playCurrent(): void {
        const slot = this.current;
        if (!slot || !this.canPlay() || slot.ended || slot.failed || slot.pending || !slot.media.paused) return;
        const attempt = ++slot.attempt;
        slot.pending = true;
        this.onState("loading");
        // No await/tick before play(): Safari needs the original gesture's activation.
        void slot.media.play().then(
            () => {
                if (this.current !== slot || slot.attempt !== attempt || !this.canPlay()) return;
                slot.pending = false;
                slot.confirmed = true;
                if (!slot.graph && this.plainRetryUrls.delete(slot.source.url)) {
                    // It plays without CORS mode, so CORS was the problem (not a 404 or a bad file).
                    const origin = originOf(slot.source.url);
                    if (origin !== window.location.origin) this.originCors.set(origin, false);
                }
                this.startFade();
                if (slot.graph && this.context && this.context.state !== "running") {
                    // The element plays, but a suspended context outputs silence until a gesture resumes it.
                    this.contextBlocked = true;
                    this.resumeContext();
                    this.onState("not_allowed");
                    return;
                }
                this.onState("playing");
            },
            (error: unknown) => {
                if (this.current !== slot || slot.attempt !== attempt || !this.canPlay()) return;
                slot.pending = false;
                this.fail(
                    slot,
                    error instanceof DOMException && error.name === "NotAllowedError" ? "not_allowed" : "error"
                );
            }
        );
    }

    private swapToPlain(slot: Slot): void {
        const source = slot.source;
        this.current = undefined;
        this.release(slot);
        // The host was just asked (or just failed to load): do not ask again for the same track.
        this.swapping = true;
        try {
            this.setSource(source);
        } finally {
            this.swapping = false;
        }
    }

    /**
     * Ask a cross-origin host about CORS while the first (gesture-less) play is still blocked, so a host
     * without it gets its plain element before the tap. Otherwise the plain element would only be created
     * after the tap's play() failed, and Safari would need a second tap for it.
     */
    private probeCors(url: string): void {
        const origin = originOf(url);
        if (this.originCors.get(origin) === true || this.probingOrigins.has(origin)) return;
        if (origin === window.location.origin) return;
        this.probingOrigins.add(origin);
        void this.checkCors(url).then((allowed) => {
            this.probingOrigins.delete(origin);
            if (this.destroyed) return;
            this.originCors.set(origin, allowed);
            const slot = this.current;
            if (allowed || !slot?.graph || slot.confirmed || originOf(slot.source.url) !== origin) return;
            this.swapToPlain(slot);
        });
    }

    private fail(slot: Slot, state: "not_allowed" | "error"): void {
        if (state === "error" && slot.graph && !slot.confirmed && this.current === slot) {
            // CORS-mode loading failed before any sound: try this track through a plain element instead.
            this.plainRetryUrls.add(slot.source.url);
            this.swapToPlain(slot);
            return;
        }
        if (state === "error") this.plainRetryUrls.delete(slot.source.url);
        slot.attempt++;
        slot.pending = false;
        slot.failed = state;
        slot.media.pause();
        this.cancelFade();
        // Keep a working bed while the browser waits for permission for its second
        // element. Pause/stop/unload still silence both immediately.
        if (state !== "not_allowed") {
            this.release(this.outgoing);
            this.outgoing = undefined;
        }
        this.onState(state);
    }

    private startFade(): void {
        this.cancelFade();
        const incoming = this.current;
        if (!incoming) return;
        const outgoing = this.outgoing;
        // Some mobile browsers ignore element volume. Without a gain node there, never run a
        // gain-based overlap: retire the old slot as soon as the new one confirms play.
        if (!this.canSetLevel(incoming) || (outgoing && !this.canSetLevel(outgoing))) {
            incoming.envelope = 1;
            this.release(outgoing);
            this.outgoing = undefined;
            this.applyVolumes();
            return;
        }
        const incomingStart = incoming.envelope;
        const outgoingStart = outgoing?.envelope ?? 0;
        if (incomingStart === 1 && !outgoing) return;
        const start = performance.now();
        const step = () => {
            this.fadeTimer = undefined;
            if (this.current !== incoming || !this.canPlay()) return;
            // Background timers may be late. Use elapsed time rather than frame/tick
            // counts so the first late tick completes a finished transition.
            const progress = Math.min(1, Math.max(0, (performance.now() - start) / this.duration));
            incoming.envelope = incomingStart + (1 - incomingStart) * progress;
            if (outgoing) outgoing.envelope = outgoingStart * (1 - progress);
            this.applyVolumes();
            if (progress < 1) {
                this.fadeTimer = setTimeout(step, 50);
            } else {
                this.release(outgoing);
                this.outgoing = undefined;
            }
        };
        step();
    }

    private detectVolumeSupport(media: HTMLAudioElement): void {
        if (this.volumeSupported !== undefined) return;
        // Probe a newly created, silent element before assigning a source. Avoid
        // browser/OS sniffing, including assumptions about future iOS versions.
        const initial = media.volume;
        try {
            media.volume = 0.5;
            this.volumeSupported = Math.abs(media.volume - 0.5) < 0.001;
            media.volume = initial;
        } catch {
            this.volumeSupported = false;
        }
    }

    private applyVolumes(): void {
        const master = this.controls.volume * (this.controls.talking && this.controls.decreaseWhileTalking ? 0.5 : 1);
        for (const slot of [this.current, this.outgoing]) {
            if (!slot) continue;
            slot.media.muted = this.controls.muted;
            const level = clampAudioVolume(master * slot.source.volume * slot.envelope);
            if (slot.graph) {
                this.setGain(slot.graph, this.controls.muted ? 0 : level);
            } else if (this.volumeSupported) {
                slot.media.volume = level;
            }
            slot.media.loop = slot.source.loop;
        }
    }

    private canSetLevel(slot: Slot): boolean {
        return !!slot.graph || !!this.volumeSupported;
    }

    private ensureContext(): AudioContext | undefined {
        if (this.context) return this.context;
        try {
            const context = this.createContext();
            if (!context) return undefined;
            context.onstatechange = () => {
                if (this.destroyed) return;
                if (context.state === "running") {
                    if (!this.contextBlocked) return;
                    this.contextBlocked = false;
                    if (this.current?.confirmed) this.onState("playing");
                    return;
                }
                // Screen lock, a call or backgrounding silences the graph while the element keeps "playing".
                const slot = this.current;
                if (slot?.graph && slot.confirmed && this.canPlay() && !slot.media.paused) {
                    this.contextBlocked = true;
                    this.resumeContext();
                    this.onState("not_allowed");
                }
            };
            this.context = context;
            if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVisible);
        } catch {
            this.context = undefined;
        }
        return this.context;
    }

    private readonly onVisible = (): void => {
        if (document.visibilityState === "visible") this.resumeContext();
    };

    private resumeContext(): void {
        if (this.context && this.context.state !== "running") void this.context.resume().catch(() => undefined);
    }

    /** Route one element through a gain node; undefined (plain element) when Web Audio is not available. */
    private attachGraph(media: HTMLAudioElement): GainNode | undefined {
        const existing = this.gains.get(media);
        if (existing) return existing;
        const context = this.ensureContext();
        if (!context) return undefined;
        try {
            // Must be set before src is assigned; a Web Audio source needs a CORS-clean response.
            media.crossOrigin = "anonymous";
            const source = context.createMediaElementSource(media);
            const gain = context.createGain();
            gain.gain.value = 0;
            source.connect(gain);
            gain.connect(context.destination);
            this.gains.set(media, gain);
            return gain;
        } catch {
            return undefined;
        }
    }

    private setGain(gain: GainNode, target: number): void {
        const now = this.context?.currentTime ?? 0;
        gain.gain.cancelScheduledValues(now);
        // Zero is immediate; other changes use a short ramp so the slider does not click.
        if (target === 0) gain.gain.setValueAtTime(0, now);
        else gain.gain.setTargetAtTime(target, now, 0.02);
    }

    private cancelFade(): void {
        if (this.fadeTimer !== undefined) clearTimeout(this.fadeTimer);
        this.fadeTimer = undefined;
    }

    private release(slot: Slot | undefined): void {
        if (!slot) return;
        // A plain retry dropped before it played proved nothing about CORS.
        if (!slot.graph && !slot.confirmed) this.plainRetryUrls.delete(slot.source.url);
        slot.attempt++;
        slot.media.onended = null;
        slot.media.onerror = null;
        slot.media.pause();
        slot.media.removeAttribute("src");
        slot.media.load();
        if (this.audioContainer) slot.media.remove();
        this.idleMedia.push(slot.media);
    }
}
