// A session = one bot in one bubble, with one lane per person. The bot server decides who gets a connection and when
// (it follows the game's own transport rules); the session only carries it out, and keeps exactly one current path per
// person: a newer epoch replaces the old lane, and anything still addressed to the old epoch is dropped.
import type { Counters } from './counters.ts';
import { FakeSpeech } from './fakeSpeech.ts';
import { Lane, type IceConfig } from './lane.ts';
import type { LeaveReason, Mode, Signal, WorkerToBot } from './protocol.ts';
import { Speaker } from './speaker.ts';
import type { InputSink } from './transport.ts';

/** A connection that has not come up this long after the person's offer is given up. */
const CONNECT_TIMEOUT_MS = 20000;
const STATUS_INTERVAL_MS = 5000;

/** A message to the bot server as the session writes it; the session id and time are added on the way out. */
export type OutgoingMessage = WorkerToBot extends infer M ? (M extends WorkerToBot ? Omit<M, 'sessionId' | 'ts'> : never) : never;

export interface SessionHost {
    engineId: string;
    counters: Counters;
    ice: IceConfig;
    input: InputSink;
    speech: FakeSpeech;
    /** Lanes alive in the whole worker, to enforce the limit. */
    laneCount(): number;
    maxLanes: number;
    send(message: OutgoingMessage): void;
}

export class Session {
    voice: 'active' | 'stopped' = 'active';
    readonly lanes = new Map<string, Lane>();
    private readonly newest = new Map<string, number>();
    private readonly timers = new Map<Lane, NodeJS.Timeout>();
    private readonly speaker: Speaker;
    private readonly statusTimer: NodeJS.Timeout;
    private closing = false;

    constructor(readonly id: string, readonly bubbleId: string, readonly botId: string, private readonly host: SessionHost, public defaultMode: Mode = 'talk') {
        this.speaker = new Speaker({
            counters: host.counters,
            speech: host.speech,
            targets: () => [...this.lanes.values()],
            active: () => this.voice === 'active',
            progress: (message) => host.send({ type: 'playback.progress', ...message }),
        });
        this.statusTimer = setInterval(() => this.sendStatus(), STATUS_INTERVAL_MS);
        this.statusTimer.unref?.();
    }

    /** Starts a connection with a person. A newer epoch replaces the one before it; an older or equal one is refused. */
    async openLane(participantId: string, epoch: number, mode: Mode = this.defaultMode): Promise<void> {
        const c = this.host.counters;
        if (epoch <= (this.newest.get(participantId) ?? 0)) {
            c.inc('stale_dropped');
            this.host.send({ type: 'error', code: 'stale_epoch', message: 'lane.open with an old epoch', participantId, epoch });
            return;
        }
        const old = this.lanes.get(participantId);
        if (!old && this.host.laneCount() >= this.host.maxLanes) {
            c.inc('lanes_refused');
            this.host.send({ type: 'error', code: 'at_capacity', message: 'too many audio connections', participantId, epoch });
            return;
        }
        this.newest.set(participantId, epoch);
        // One path at a time: the old one is fenced before the new one can carry anything
        if (old) await this.dropLane(old, 'superseded', false);
        const lane = new Lane(
            participantId,
            epoch,
            mode,
            {
                counters: c,
                ice: this.host.ice,
                input: this.host.input,
                sendSignal: (l, signal) => this.currentLane(l) && this.host.send({ type: 'lane.signal', participantId: l.participantId, epoch: l.epoch, signal }),
                onConnected: (l) => {
                    if (!this.currentLane(l)) return;
                    this.clearTimer(l);
                    c.inc('lanes_connected');
                    this.host.send({ type: 'participant.join', participantId: l.participantId, epoch: l.epoch });
                    this.sendStatus();
                },
                onGone: (l, reason) => void this.dropLane(l, reason, true),
            },
            () => this.voice === 'active'
        );
        this.lanes.set(participantId, lane);
        c.inc('lanes_opened');
        this.timers.set(lane, setTimeout(() => void this.dropLane(lane, 'timeout', true), CONNECT_TIMEOUT_MS));
    }

    private currentLane(lane: Lane): boolean {
        return !lane.gone && this.lanes.get(lane.participantId) === lane;
    }

    private clearTimer(lane: Lane): void {
        clearTimeout(this.timers.get(lane));
        this.timers.delete(lane);
    }

    /** Hands a signal from the person to its lane. Anything not addressed to the current lane is dropped. */
    async signal(participantId: string, epoch: number, signal: Signal): Promise<void> {
        const lane = this.laneFor(participantId, epoch);
        if (lane) await lane.signal(signal);
    }

    async closeLane(participantId: string, epoch: number, reason: LeaveReason = 'left'): Promise<void> {
        const lane = this.laneFor(participantId, epoch);
        if (lane) await this.dropLane(lane, reason, true);
    }

    private laneFor(participantId: string, epoch: number): Lane | undefined {
        const lane = this.lanes.get(participantId);
        if (!lane || lane.epoch !== epoch || lane.gone) {
            this.host.counters.inc('stale_dropped');
            this.host.send({ type: 'error', code: 'stale_epoch', message: 'no current lane for that epoch', participantId, epoch });
            return undefined;
        }
        return lane;
    }

    /** Ends a lane. The leave is announced for the lane that was current; a replaced lane is only closed. */
    private async dropLane(lane: Lane, reason: LeaveReason, announce: boolean): Promise<void> {
        if (lane.gone) return;
        const current = this.lanes.get(lane.participantId) === lane;
        this.clearTimer(lane);
        // gone is set first: from here on nothing more is heard from or sent to this path
        lane.gone = true;
        if (current) this.lanes.delete(lane.participantId);
        this.host.counters.inc('lanes_closed');
        if (announce && current && !this.closing) {
            this.host.send({ type: 'participant.leave', participantId: lane.participantId, epoch: lane.epoch, reason });
        }
        await lane.stop();
        if (!this.closing) this.sendStatus();
    }

    setMode(mode: Mode, participantId?: string): void {
        if (!participantId) {
            this.defaultMode = mode;
            for (const lane of this.lanes.values()) lane.mode = mode;
        } else {
            const lane = this.lanes.get(participantId);
            if (lane) lane.mode = mode;
        }
        this.sendStatus();
    }

    say(segmentId: string, text: string): void {
        this.speaker.enqueue(segmentId, text);
    }

    retract(segmentId: string): void {
        this.speaker.retract(segmentId);
    }

    stopVoice(): void {
        this.voice = 'stopped';
        this.speaker.stopAll('voice_stop');
        this.sendStatus();
    }

    sendStatus(): void {
        if (this.closing) return;
        this.host.send({
            type: 'engine.status',
            engineId: this.host.engineId,
            voice: this.voice,
            mode: this.defaultMode,
            lanes: [...this.lanes.values()].filter((l) => !l.gone).map((l) => ({ participantId: l.participantId, epoch: l.epoch, healthy: l.healthy(), mode: l.mode })),
            counters: this.host.counters.snapshot(),
        });
    }

    async close(): Promise<void> {
        if (this.closing) return;
        this.closing = true;
        clearInterval(this.statusTimer);
        await this.speaker.shutdown();
        const lanes = [...this.lanes.values()];
        this.lanes.clear();
        for (const lane of lanes) this.clearTimer(lane);
        await Promise.allSettled(lanes.map((lane) => ((lane.gone = true), lane.stop())));
    }
}
