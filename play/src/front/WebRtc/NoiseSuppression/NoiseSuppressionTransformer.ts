import { AbortError } from "@workadventure/shared-utils/src/Abort/AbortError";
import {
    createNoiseSuppressionAudioWorklet,
    observeNoiseSuppressionAudioWorkletMessages,
    type NoiseSuppressionAudioWorkletHandle,
    type NoiseSuppressionAudioWorkletOutboundMessage,
} from "@workadventure/noise-suppression/audio-worklet";
import {
    createDeepFilterNetAudioWorklet,
    DEEPFILTERNET_SAMPLE_RATE,
} from "@workadventure/noise-suppression/deepfilternet";

/**
 * "deepfilternet": DeepFilterNet3, full band at 48 kHz (keeps the whole voice, removes keystrokes).
 * "dtln": DTLN at 16 kHz, lighter but muffled. Only used when DeepFilterNet3 cannot start.
 */
export type NoiseSuppressionEngine = "deepfilternet" | "dtln";

export interface NoiseSuppressionStatusMessage {
    status: "initializing" | "ready" | "error";
    message?: string;
    /** The device cannot keep up with the model: another engine would not help, go back to the browser's filter. */
    overloaded?: boolean;
}

interface NoiseSuppressionTransformerOptions {
    engine: NoiseSuppressionEngine;
    onStatusChange?: (message: NoiseSuppressionStatusMessage) => void;
}

/** What both engines' worklet handles have in common. */
interface WorkletHandle {
    node: AudioWorkletNode;
    ready: Promise<unknown>;
    dispose(): void;
}

interface NoiseSuppressionSupport {
    supported: boolean;
    message?: string;
}

const DTLN_SAMPLE_RATE = 16000;
export class NoiseSuppressionTransformer {
    public readonly engine: NoiseSuppressionEngine;
    private readonly audioContext: AudioContext;
    private readonly onStatusChange?: (message: NoiseSuppressionStatusMessage) => void;
    private lastProcessorStatus: NoiseSuppressionStatusMessage["status"] | undefined;
    private sourceNode: MediaStreamAudioSourceNode | undefined;
    private workletHandle: WorkletHandle | undefined;
    private processorErrorNode: AudioWorkletNode | undefined;
    // Shared by overlapping transform() calls, so only one worklet is ever created.
    private workletHandleCreation: Promise<void> | undefined;
    private destroyed = false;
    private stopObservingWorkletMessages: (() => void) | undefined;
    private destinationNode: MediaStreamAudioDestinationNode | undefined;
    private outputTrack: MediaStreamTrack | undefined;
    private inputTrack: MediaStreamTrack | undefined;

    constructor(options: NoiseSuppressionTransformerOptions) {
        this.engine = options.engine;
        this.audioContext = new AudioContext({
            sampleRate: this.engine === "dtln" ? DTLN_SAMPLE_RATE : DEEPFILTERNET_SAMPLE_RATE,
        });
        this.onStatusChange = options.onStatusChange;
        // Safari and background tabs suspend the context: the output track stays "live" but carries silence.
        this.audioContext.addEventListener("statechange", this.resumeIfSuspended);
        document.addEventListener("visibilitychange", this.resumeIfSuspended);
    }

    public static getSupport(): NoiseSuppressionSupport {
        if (typeof AudioContext === "undefined") {
            return {
                supported: false,
                message: "AudioContext is not available in this browser.",
            };
        }

        if (typeof AudioWorkletNode === "undefined" || !("audioWorklet" in AudioContext.prototype)) {
            return {
                supported: false,
                message: "AudioWorklet is not available in this browser.",
            };
        }

        return { supported: true };
    }

    public async transform(inputTrack: MediaStreamTrack, signal?: AbortSignal): Promise<MediaStreamTrack> {
        this.throwIfAborted(signal);

        if (this.inputTrack === inputTrack && this.outputTrack) {
            return this.outputTrack;
        }

        // The previous output keeps playing until the new one is wired, so a microphone switch has no silent gap.
        this.onStatusChange?.({
            status: this.lastProcessorStatus === "ready" ? "ready" : "initializing",
        });

        await this.audioContext.resume();
        this.throwIfAborted(signal);
        await this.ensureWorkletHandleCreated();
        this.throwIfAborted(signal);

        const workletHandle = this.workletHandle;
        if (!workletHandle) {
            throw new Error("Noise suppression worklet node failed to initialize.");
        }
        // Loading the model blocks the audio thread for a moment (~0.3 s for DeepFilterNet3): wire the microphone
        // only once it is done, or the voice we send drops out right when the filter starts. A failure rejects here.
        await workletHandle.ready;
        this.throwIfAborted(signal);
        if (this.destroyed || this.workletHandle !== workletHandle) {
            throw new AbortError("Noise suppression transformer was destroyed");
        }

        const inputStream = new MediaStream([inputTrack]);
        const sourceNode = this.audioContext.createMediaStreamSource(inputStream);
        const destinationNode = this.audioContext.createMediaStreamDestination();
        const outputTrack = destinationNode.stream.getAudioTracks()[0];
        if (!outputTrack) {
            throw new Error("Noise suppression worklet did not produce an audio track.");
        }

        this.disconnectGraph();
        sourceNode.connect(workletHandle.node);
        workletHandle.node.connect(destinationNode);

        this.sourceNode = sourceNode;
        this.destinationNode = destinationNode;
        this.outputTrack = outputTrack;
        this.inputTrack = inputTrack;

        return outputTrack;
    }

    /** Disconnects the microphone and pauses the audio context, so the model uses no CPU until the next transform. */
    public stop(): void {
        this.disconnectGraph();
        if (this.audioContext.state === "running") {
            this.audioContext.suspend().catch((error: unknown) => {
                console.warn("[NoiseSuppressionTransformer] Could not pause the audio context:", error);
            });
        }
    }

    private disconnectGraph(): void {
        const workletNode = this.workletHandle?.node;

        if (this.sourceNode && workletNode) {
            try {
                this.sourceNode.disconnect(workletNode);
            } catch {
                // Ignore disconnect errors when tearing down a stale graph.
            }
        } else if (this.sourceNode) {
            try {
                this.sourceNode.disconnect();
            } catch {
                // Ignore disconnect errors when tearing down a stale graph.
            }
        }

        if (workletNode && this.destinationNode) {
            try {
                workletNode.disconnect(this.destinationNode);
            } catch {
                // Ignore disconnect errors when tearing down a stale graph.
            }
        } else if (workletNode) {
            try {
                workletNode.disconnect();
            } catch {
                // Ignore disconnect errors when tearing down a stale graph.
            }
        }

        this.outputTrack?.stop();

        this.sourceNode = undefined;
        this.destinationNode = undefined;
        this.outputTrack = undefined;
        this.inputTrack = undefined;
    }

    private async ensureWorkletHandleCreated(): Promise<void> {
        if (this.workletHandle) {
            return;
        }

        if (!this.workletHandleCreation) {
            this.workletHandleCreation = this.createWorkletHandle().finally(() => {
                this.workletHandleCreation = undefined;
            });
        }
        await this.workletHandleCreation;
    }

    private async createWorkletHandle(): Promise<void> {
        const workletHandle =
            this.engine === "dtln" ? await this.createDtlnWorklet() : await this.createDeepFilterNetWorklet();

        if (this.destroyed) {
            this.stopObservingWorkletMessages?.();
            this.stopObservingWorkletMessages = undefined;
            workletHandle.dispose();
            throw new AbortError("Noise suppression transformer was destroyed");
        }

        this.workletHandle = workletHandle;
        // A crash after start-up (e.g. a wasm trap) only surfaces here.
        this.processorErrorNode = workletHandle.node;
        this.processorErrorNode.addEventListener("processorerror", this.handleProcessorError);

        workletHandle.ready
            .then(() => {
                if (this.workletHandle !== workletHandle) {
                    return;
                }

                this.lastProcessorStatus = "ready";
                this.onStatusChange?.({ status: "ready" });
            })
            .catch((error: unknown) => {
                if (this.workletHandle !== workletHandle) {
                    return;
                }

                this.reportError(
                    error instanceof Error ? error.message : "Custom noise suppression failed to initialize."
                );
            });
    }

    private async createDtlnWorklet(): Promise<WorkletHandle> {
        const workletHandle: NoiseSuppressionAudioWorkletHandle = await createNoiseSuppressionAudioWorklet(
            this.audioContext,
            { bypassUntilReady: true }
        );
        if (!this.destroyed) {
            this.stopObservingWorkletMessages = observeNoiseSuppressionAudioWorkletMessages(
                workletHandle,
                (message: NoiseSuppressionAudioWorkletOutboundMessage) => {
                    this.handleWorkletMessage(message);
                }
            );
        }
        return workletHandle;
    }

    private createDeepFilterNetWorklet(): Promise<WorkletHandle> {
        // Package defaults: 25 dB of attenuation while speaking (a faint, steady background), 45 dB in pauses.
        return createDeepFilterNetAudioWorklet(this.audioContext, {
            bypassUntilReady: true,
            // The device cannot keep up (two 2 s windows over 70 % of real time): the audio would crackle, so hand
            // over to the browser's filter like any other failure. Another engine would not help.
            onOverload: (load) => {
                if (!this.workletHandle) {
                    return; // Destroyed meanwhile
                }
                this.reportError(
                    `Noise suppression is too heavy for this device (${Math.round(load * 100)} % of real time).`,
                    true
                );
            },
        });
    }

    /** A failure is reported once, even when the worklet reports it through several channels. */
    private reportError(message: string, overloaded = false): void {
        if (this.lastProcessorStatus === "error") {
            return;
        }
        this.lastProcessorStatus = "error";
        this.onStatusChange?.({ status: "error", message, overloaded });
    }

    private readonly handleProcessorError = (): void => {
        this.reportError("The noise suppression AudioWorklet processor failed.");
    };

    /**
     * Safari and background tabs suspend the context behind our back, and the output track then carries silence.
     * Not while stopped on purpose: stop() clears the output track.
     */
    private readonly resumeIfSuspended = (): void => {
        if (this.audioContext.state === "running" || this.audioContext.state === "closed" || !this.outputTrack) {
            return;
        }
        this.audioContext.resume().catch((error: unknown) => {
            // Silence is worse than noise: give up so the browser's filter takes over.
            console.warn("[NoiseSuppressionTransformer] Could not resume the audio context:", error);
            this.reportError("Noise suppression was suspended by the browser.");
        });
    };

    public async closeAndDestroy(): Promise<void> {
        this.destroyed = true;
        this.audioContext.removeEventListener("statechange", this.resumeIfSuspended);
        document.removeEventListener("visibilitychange", this.resumeIfSuspended);
        this.stop();
        this.stopObservingWorkletMessages?.();
        this.stopObservingWorkletMessages = undefined;
        if (this.workletHandle) {
            this.processorErrorNode?.removeEventListener("processorerror", this.handleProcessorError);
            this.processorErrorNode = undefined;
            this.workletHandle.dispose();
            this.workletHandle = undefined;
        }
        if (this.audioContext.state !== "closed") {
            await this.audioContext.close();
        }
    }

    private throwIfAborted(signal?: AbortSignal): void {
        if (!signal?.aborted) {
            return;
        }

        throw signal.reason instanceof Error ? signal.reason : new AbortError("Noise suppression transform aborted");
    }

    private handleWorkletMessage(message: NoiseSuppressionAudioWorkletOutboundMessage): void {
        if (message.type === "error") {
            this.reportError(message.message);
            return;
        }

        if (message.type === "processing-started") {
            return;
        }

        if (message.type === "benchmark-complete") {
            return;
        }
    }
}
