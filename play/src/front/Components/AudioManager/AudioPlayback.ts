/** One native music channel, with at most two media elements during a source change. */
export interface AudioSource {
    url: string;
    volume: number;
    loop: boolean;
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
    failed: "not_allowed" | "error" | undefined;
};

export function clampAudioVolume(volume: number | undefined): number {
    return volume === undefined || !Number.isFinite(volume) ? 1 : Math.max(0, Math.min(1, volume));
}

export class AudioPlayback {
    private current: Slot | undefined;
    private outgoing: Slot | undefined;
    private frame: number | undefined;
    // Reuse media elements: some browsers grant autoplay permission per element.
    private readonly idleMedia: HTMLAudioElement[] = [];
    private hidden = false;
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
        private readonly duration = 1600
    ) {}

    setSource(source: AudioSource | undefined): void {
        if (this.destroyed) return;
        if (source && this.current?.source.url === source.url) {
            this.current.source = { ...source, volume: clampAudioVolume(source.volume) };
            this.applyVolumes();
            return;
        }
        this.cancelFade();
        // An interrupted fade may have a silent incoming slot. Retain the more audible
        // viable track rather than replacing an established bed with that silent target.
        const candidates = [this.current, this.outgoing].filter(
            (slot): slot is Slot =>
                !!slot && this.canPlay() && !slot.media.paused && !slot.pending && !slot.failed && !slot.ended
        );
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
        const media = this.idleMedia.pop() ?? this.createAudio();
        const slot: Slot = {
            media,
            source: { ...source, volume: clampAudioVolume(source.volume) },
            envelope: this.outgoing ? 0 : 1,
            attempt: 0,
            pending: false,
            ended: this.hidden && !source.loop,
            failed: undefined,
        };
        this.current = slot;
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
            if (this.current === slot) this.fail(slot, "error");
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

    setHidden(hidden: boolean): void {
        if (hidden === this.hidden) return;
        this.hidden = hidden;
        if (hidden) {
            this.suspend();
            // A one-shot cue missed in the background must not be replayed on return.
            if (this.current && !this.current.source.loop) this.current.ended = true;
        } else {
            this.playCurrent();
        }
    }

    /** Called synchronously in the native user gesture handler for autoplay recovery. */
    retry(): void {
        if (this.current) {
            // A resource error needs a fresh media load. Autoplay recovery must remain
            // in the original gesture and must not reset an otherwise healthy source.
            if (this.current.failed === "error") this.current.media.load();
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
        this.onState(undefined);
    }

    private canPlay(): boolean {
        return !this.destroyed && !this.hidden && !this.controls.paused && !this.controls.stopped;
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
                this.onState("playing");
                this.startFade();
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

    private fail(slot: Slot, state: "not_allowed" | "error"): void {
        slot.attempt++;
        slot.pending = false;
        slot.failed = state;
        slot.media.pause();
        this.cancelFade();
        // Keep a working bed while the browser waits for permission for its second
        // element. Pause/stop/hide/unload still silence both immediately.
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
        const incomingStart = incoming.envelope;
        const outgoingStart = outgoing?.envelope ?? 0;
        if (incomingStart === 1 && !outgoing) return;
        let start: number | undefined;
        const step = (now: number) => {
            if (this.current !== incoming || !this.canPlay()) return;
            start ??= now;
            const progress = Math.min(1, (now - start) / this.duration);
            incoming.envelope = incomingStart + (1 - incomingStart) * progress;
            if (outgoing) outgoing.envelope = outgoingStart * (1 - progress);
            this.applyVolumes();
            if (progress < 1) {
                this.frame = requestAnimationFrame(step);
            } else {
                this.frame = undefined;
                this.release(outgoing);
                this.outgoing = undefined;
            }
        };
        this.frame = requestAnimationFrame(step);
    }

    private applyVolumes(): void {
        const master = this.controls.volume * (this.controls.talking && this.controls.decreaseWhileTalking ? 0.5 : 1);
        for (const slot of [this.current, this.outgoing]) {
            if (!slot) continue;
            slot.media.muted = this.controls.muted;
            slot.media.volume = clampAudioVolume(master * slot.source.volume * slot.envelope);
            slot.media.loop = slot.source.loop;
        }
    }

    private cancelFade(): void {
        if (this.frame !== undefined) cancelAnimationFrame(this.frame);
        this.frame = undefined;
    }

    private release(slot: Slot | undefined): void {
        if (!slot) return;
        slot.attempt++;
        slot.media.onended = null;
        slot.media.onerror = null;
        slot.media.pause();
        slot.media.removeAttribute("src");
        slot.media.load();
        this.idleMedia.push(slot.media);
    }
}
