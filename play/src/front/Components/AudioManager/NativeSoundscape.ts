import { AudioPlayback, clampAudioVolume } from "./AudioPlayback";
import type { AudioSource, AudioControls } from "./AudioPlayback";

export interface Emitter extends AudioSource {
    x: number;
    y: number;
    innerRadius: number;
    outerRadius: number;
}
export type Channel = "music" | "water" | "context";
export type State = "loading" | "playing" | "not_allowed" | "error" | undefined;
export interface Dependencies {
    audioContainer: HTMLElement;
    onPlayerState?: (state: State) => void;
    createContext?: () => AudioContext;
    createAudio?: () => HTMLAudioElement;
    onState?: (channel: Channel, state: State) => void;
    fadeDuration?: number;
}

/** Pure player-space falloff; camera position and zoom are deliberately absent. */
export function distanceGain(emitter: Emitter, x: number, y: number): number {
    const distance = Math.hypot(x - emitter.x, y - emitter.y);
    const t = Math.max(0, Math.min(1, (distance - emitter.innerRadius) / (emitter.outerRadius - emitter.innerRadius)));
    return 1 - t * t * (3 - 2 * t);
}

/** Reject unsupported graph URLs and gains before allocating or changing media. */
function validateSource(source: AudioSource): void {
    const url = new URL(source.url);
    if (!["https:", "http:"].includes(url.protocol)) throw new Error("Only HTTP(S) asset URLs are supported");
    if (!Number.isFinite(source.volume) || source.volume < 0 || source.volume > 1)
        throw new Error("Invalid source volume");
}
/** Validate one finite player-space emitter with a nonempty attenuation interval. */
function validateEmitter(emitter: Emitter): void {
    validateSource(emitter);
    if (
        ![emitter.x, emitter.y, emitter.innerRadius, emitter.outerRadius].every(Number.isFinite) ||
        emitter.innerRadius < 0 ||
        emitter.outerRadius <= emitter.innerRadius
    )
        throw new Error("Invalid emitter geometry");
}

/**
 * Opt-in native controller. It does not import or modify global stores, Phaser,
 * voice audio, or the legacy default path. AudioPlayback remains unchanged.
 * Assets MUST be same-origin or CORS-enabled; errors never spawn bypass audio.
 */
export class NativeSoundscape {
    private context?: AudioContext;
    private readonly nodes = new Map<
        HTMLAudioElement,
        { source: MediaElementAudioSourceNode; gain: GainNode; media: HTMLAudioElement }
    >();
    private readonly graphs = new WeakMap<
        HTMLAudioElement,
        { source: MediaElementAudioSourceNode; gain: GainNode; media: HTMLAudioElement }
    >();
    private readonly music: AudioPlayback;
    private readonly water: AudioPlayback;
    private emitter?: Emitter;
    private position?: { x: number; y: number };
    private destroyed = false;
    private generation = 0;
    private readonly createContext: () => AudioContext;
    private readonly createAudio: () => HTMLAudioElement;
    private readonly onState: (channel: Channel, state: State) => void;
    private readonly channelStates: Partial<Record<Channel, State>> = {};
    private readonly actualElements = new WeakMap<HTMLAudioElement, HTMLAudioElement>();
    private hasMusic = false;
    private hasEmitter = false;
    private controls: AudioControls = {
        volume: 1,
        muted: false,
        paused: false,
        stopped: false,
        talking: false,
        decreaseWhileTalking: true,
    };
    private readonly onPlayerState: (state: State) => void;

    /** Compose existing music/ambience players; the component retains ownership of real DOM media. */
    constructor(dependencies: Dependencies) {
        this.createContext = dependencies.createContext ?? (() => new AudioContext());
        this.createAudio = dependencies.createAudio ?? (() => new Audio());
        this.onPlayerState = dependencies.onPlayerState ?? (() => {});
        this.onState = (channel, state) => {
            this.channelStates[channel] = state;
            dependencies.onState?.(channel, state);
            this.publishState();
        };
        const actualElements = this.actualElements;
        const activate = (media: HTMLAudioElement) => this.activateGraph(media);
        // AudioPlayback still attaches/retire slots exactly as PR712 does. Only
        // append unwraps the native media adapter; a Proxy never enters the DOM.
        const container = new Proxy(dependencies.audioContainer, {
            get(target, property) {
                if (property === "append")
                    return (media: HTMLAudioElement) => {
                        const actual = actualElements.get(media) ?? media;
                        activate(actual);
                        target.append(actual);
                    };
                const value = Reflect.get(target, property, target);
                return typeof value === "function" ? value.bind(target) : value;
            },
        });
        this.music = new AudioPlayback(
            (state) => this.onState("music", state),
            () => {
                this.hasMusic = false;
                this.publishState();
            },
            () => this.createGraphMedia(),
            dependencies.fadeDuration,
            container
        );
        this.water = new AudioPlayback(
            (state) => this.onState("water", state),
            () => {},
            () => this.createGraphMedia(),
            0,
            container
        );
    }

    /** Apply the same native user controls to both channels without changing source metadata. */
    setControls(controls: AudioControls): void {
        if (this.destroyed) return;
        this.controls = { ...controls };
        this.music.setControls(controls);
        this.water.setControls(controls);
        this.publishState();
    }

    /** Select music through AudioPlayback; report invalid input as native error, never subscriber exceptions. */
    setMusic(source: AudioSource | undefined): void {
        if (this.destroyed) return;
        this.hasMusic = !!source;
        try {
            if (source) validateSource(source);
            this.music.setSource(source);
        } catch {
            this.music.setSource(undefined);
            this.onState("music", "error");
        }
        this.publishState();
    }

    /** Replace the single ambience voice without a fourth crossfade slot; same-URL gain updates retain media. */
    setEmitter(emitter: Emitter | undefined): void {
        if (this.destroyed) return;
        this.hasEmitter = !!emitter;
        try {
            if (emitter) validateEmitter(emitter);
            // Only one ambience voice: emitter URL changes are an explicit replacement,
            // never a second independently fading waterfall.
            if (emitter?.url !== this.emitter?.url) this.water.setSource(undefined);
            this.emitter = emitter ? { ...emitter, loop: true } : undefined;
            this.updateWater();
        } catch {
            this.emitter = undefined;
            this.water.setSource(undefined);
            this.onState("water", "error");
        }
        this.publishState();
    }

    /** Update player-space proximity without replaying music; nonfinite positions safely silence ambience. */
    setListenerPosition(x: number, y: number): void {
        if (this.destroyed) return;
        if (![x, y].every(Number.isFinite)) {
            this.clearListenerPosition();
            return;
        }
        this.position = { x, y };
        this.updateWater();
    }

    /** Forget a departing map/player position so the previous location cannot keep ambience audible. */
    clearListenerPosition(): void {
        if (this.destroyed) return;
        this.position = undefined;
        this.updateWater();
    }

    /** Call directly in the EXISTING native gesture handler, before any await. */
    retry(): void {
        if (this.destroyed) return;
        const generation = this.generation;
        if (this.context) {
            this.onState("context", "loading");
            void this.context.resume().then(
                () => {
                    if (!this.destroyed && generation === this.generation) {
                        this.onState("context", this.context?.state === "running" ? "playing" : "not_allowed");
                    }
                },
                () => {
                    if (!this.destroyed && generation === this.generation) this.onState("context", "not_allowed");
                }
            );
        }
        this.music.retry();
        this.water.retry();
    }

    /** Idempotently retire owned media/graphs and close only this controller's context. */
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.generation++;
        this.music.destroy();
        this.water.destroy();
        for (const { source, gain, media } of this.nodes.values()) {
            source.disconnect();
            gain.disconnect();
            media.remove();
        }
        this.nodes.clear();
        // This context belongs ONLY to this controller, never voice/Phaser.
        if (this.context) {
            this.context.onstatechange = null;
            void this.context.close().catch(() => {});
        }
        this.context = undefined;
        this.onState("context", undefined);
    }

    /** Aggregate active-channel failures and autoplay state for the one existing native audio UI. */
    private publishState(): void {
        if (this.destroyed || (!this.hasMusic && !this.hasEmitter)) {
            this.onPlayerState(undefined);
            return;
        }
        const active = [
            this.channelStates.context,
            ...(this.hasMusic ? [this.channelStates.music] : []),
            ...(this.hasEmitter ? [this.channelStates.water] : []),
        ];
        // Errors/blocked ambience remain visible even while the music keeps playing.
        if (active.includes("error")) this.onPlayerState("error");
        else if (active.includes("not_allowed")) this.onPlayerState("not_allowed");
        else if (this.controls.paused || this.controls.stopped) this.onPlayerState(undefined);
        else if (active.length && active.every((state) => state === "playing")) this.onPlayerState("playing");
        else this.onPlayerState("loading");
    }

    /** Apply smooth distance gain while retaining rejected-descriptor errors until explicit repair/removal. */
    private updateWater(): void {
        // A rejected descriptor remains an error until explicitly removed or repaired.
        // Movement must not clear it by selecting an empty water source again.
        if (this.hasEmitter && !this.emitter) return;
        const emitter = this.emitter;
        const gain = emitter && this.position ? distanceGain(emitter, this.position.x, this.position.y) : 0;
        try {
            this.water.setSource(emitter ? { url: emitter.url, loop: true, volume: emitter.volume * gain } : undefined);
        } catch {
            this.water.setSource(undefined);
            this.onState("water", "error");
        }
    }

    /** Reconnect the cached MediaElementSource when AudioPlayback reattaches an idle real element. */
    private activateGraph(media: HTMLAudioElement): void {
        const graph = this.graphs.get(media);
        if (!graph || !this.context || this.nodes.has(media)) return;
        graph.source.connect(graph.gain);
        graph.gain.connect(this.context.destination);
        this.nodes.set(media, graph);
    }

    /** Allocate a CORS-ready media/gain adapter; attach/retire hooks keep real DOM and graph lifetimes aligned. */
    private createGraphMedia(): HTMLAudioElement {
        const context = this.context ?? this.createContext();
        if (!this.context) {
            this.context = context;
            context.onstatechange = () => {
                if (!this.destroyed) this.onState("context", context.state === "running" ? "playing" : "not_allowed");
            };
            this.onState("context", context.state === "running" ? "playing" : "not_allowed");
        }
        const media = this.createAudio();
        // Must be set BEFORE AudioPlayback assigns src or invokes load().
        media.crossOrigin = "anonymous";
        const source = context.createMediaElementSource(media);
        const gain = context.createGain();
        gain.gain.value = 0;
        this.graphs.set(media, { source, gain, media });
        const retire = () => {
            source.disconnect();
            gain.disconnect();
            this.nodes.delete(media);
            media.remove();
        };
        let volume = 1;
        let muted = false;
        const apply = () => {
            const target = muted ? 0 : volume;
            const now = context.currentTime;
            gain.gain.cancelScheduledValues(now);
            // Zero and mute are immediate; nonzero changes use a short de-click ramp.
            if (target === 0) gain.gain.setValueAtTime(0, now);
            else gain.gain.setTargetAtTime(target, now, 0.02);
        };
        // Native-only adapter seam. Bind DOM methods to the real element to retain
        // browser brand checks; no Proxy is attached to DOM or exposed to maps.
        const adapter = new Proxy(media, {
            get(target, property) {
                if (property === "remove") return retire;
                if (property === "volume") return volume;
                if (property === "muted") return muted;
                const value = Reflect.get(target, property, target);
                return typeof value === "function" ? value.bind(target) : value;
            },
            set(target, property, value) {
                if (property === "volume") {
                    volume = clampAudioVolume(value);
                    apply();
                    return true;
                }
                if (property === "muted") {
                    muted = !!value;
                    target.muted = muted;
                    apply();
                    return true;
                }
                return Reflect.set(target, property, value, target);
            },
        });
        this.actualElements.set(adapter, media);
        return adapter;
    }
}
