import { browserElementVolume } from "../Components/AudioManager/AudioPlayback";
import { audioContextManager } from "./AudioContextManager";

export interface StreamVolumeDependencies {
    /** Whether the browser applies a volume set on a media element (false on iPhone); undefined while it is asked. */
    elementVolume: () => boolean | undefined;
    getContext: () => AudioContext | undefined;
    /** Where a tap or a key is listened for, to start a context the browser holds until one */
    gestureTarget: Pick<EventTarget, "addEventListener" | "removeEventListener"> | undefined;
}

const GESTURES = ["touchend", "pointerup", "keydown"] as const;

const defaultDependencies: StreamVolumeDependencies = {
    elementVolume: browserElementVolume,
    getContext: () => {
        try {
            return typeof AudioContext === "function" ? audioContextManager.getContext() : undefined;
        } catch {
            return undefined;
        }
    },
    gestureTarget: typeof window === "undefined" ? undefined : window,
};

/**
 * The volume of someone's live sound (a camera tile or a voice bot), set with the slider on their tile (#1851).
 *
 * Where the browser applies element volume (computers, iPad), the element's volume is set, as before. iPhone ignores
 * it, so there a level below 100% plays through a Web Audio gain node and the element is muted. At 100% the element
 * plays as it always has. The element stays the one that plays when the gain cannot: while the audio context is
 * suspended or interrupted (before a tap, a call, the screen lock) it is unmuted, so the person is never lost, only
 * heard at the phone's volume until the next tap.
 */
export class StreamVolume {
    private stream: MediaStream | undefined;
    private volume = 1;
    private context: AudioContext | undefined;
    private source: MediaStreamAudioSourceNode | undefined;
    private gain: GainNode | undefined;
    private sourceStream: MediaStream | undefined;
    private armed = false;
    private destroyed = false;

    constructor(
        private readonly element: HTMLMediaElement,
        private readonly dependencies: StreamVolumeDependencies = defaultDependencies
    ) {}

    setStream(stream: MediaStream | undefined): void {
        if (this.destroyed || stream === this.stream) return;
        this.stream = stream;
        this.apply();
    }

    setVolume(volume: number): void {
        if (this.destroyed) return;
        this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
        this.apply();
    }

    destroy(): void {
        if (this.destroyed) return;
        this.disconnect();
        this.disarm();
        this.context?.removeEventListener("statechange", this.onContextState);
        this.context = undefined;
        this.destroyed = true;
    }

    private apply(): void {
        const applies = this.dependencies.elementVolume();
        // Unknown yet: setting it costs nothing where it is ignored
        if (applies !== false) {
            this.disconnect();
            this.element.volume = this.volume;
            return;
        }
        if (this.volume >= 1 || !this.stream || this.stream.getAudioTracks().length === 0) {
            this.disconnect();
            return;
        }
        const context = this.ensureContext();
        if (!context) {
            this.disconnect();
            return;
        }
        if (!this.gain || this.sourceStream !== this.stream) {
            this.disconnect();
            try {
                const source = context.createMediaStreamSource(this.stream);
                const gain = context.createGain();
                source.connect(gain);
                gain.connect(context.destination);
                this.source = source;
                this.gain = gain;
                this.sourceStream = this.stream;
            } catch (error) {
                console.warn("StreamVolume: could not route the sound through a gain node", error);
                this.disconnect();
                return;
            }
        }
        const gain = this.gain;
        if (!gain) return;
        const now = context.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(this.volume, now);
        this.routeOutput();
    }

    /** The gain plays only while its context runs; otherwise the element plays, at the phone's volume. */
    private routeOutput(): void {
        const running = this.context?.state === "running";
        this.element.muted = !!this.gain && running;
        if (this.gain && !running) {
            this.resume();
            this.arm();
        } else {
            this.disarm();
        }
    }

    private ensureContext(): AudioContext | undefined {
        if (this.context && this.context.state !== "closed") return this.context;
        this.context?.removeEventListener("statechange", this.onContextState);
        this.context = this.dependencies.getContext();
        this.context?.addEventListener("statechange", this.onContextState);
        return this.context;
    }

    private readonly onContextState = (): void => {
        if (this.destroyed) return;
        if (this.context?.state === "closed") {
            this.disconnect();
            this.context.removeEventListener("statechange", this.onContextState);
            this.context = undefined;
            this.apply();
            return;
        }
        this.routeOutput();
    };

    private resume(): void {
        const context = this.context;
        if (!context || context.state === "running" || context.state === "closed") return;
        void context.resume().catch(() => undefined);
    }

    // iPhone starts a context only inside a tap: the next one anywhere starts it
    private readonly onGesture = (): void => {
        this.resume();
    };

    private arm(): void {
        if (this.armed || !this.dependencies.gestureTarget) return;
        this.armed = true;
        for (const type of GESTURES) {
            this.dependencies.gestureTarget.addEventListener(type, this.onGesture, { capture: true, passive: true });
        }
    }

    private disarm(): void {
        if (!this.armed || !this.dependencies.gestureTarget) return;
        this.armed = false;
        for (const type of GESTURES) {
            this.dependencies.gestureTarget.removeEventListener(type, this.onGesture, { capture: true });
        }
    }

    private disconnect(): void {
        this.source?.disconnect();
        this.gain?.disconnect();
        this.source = this.gain = this.sourceStream = undefined;
        this.disarm();
        if (!this.destroyed) this.element.muted = false;
    }
}
