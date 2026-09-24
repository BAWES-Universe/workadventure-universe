/**
 * Pure stacking and timing logic for the speech shown above one avatar.
 *
 * - Say: every line gets its own timer from the moment it is drawn. At most `maxLines` lines are kept,
 *   newest last; adding one more removes the oldest. An empty Say only removes lines that are already
 *   past their lifetime (their own timer may have been delayed, e.g. in a throttled background tab),
 *   so a "clear" sent for an older line can never wipe a newer one.
 * - Think: a single thought. A new Think replaces it, an empty Think removes it. A new Say line also
 *   removes it, since the newest thing the player sent is then that line.
 *
 * The class knows nothing about Phaser or the DOM: drawing is delegated to a {@link SayStackView}.
 */

export interface SayStackLine {
    readonly id: number;
    readonly text: string;
    readonly drawnAt: number;
}

export type SayStackRemovalReason = "expired" | "evicted" | "cleared";

export interface SayStackView {
    addLine(line: SayStackLine): void;
    removeLine(line: SayStackLine, reason: SayStackRemovalReason): void;
    showThought(text: string): void;
    hideThought(): void;
}

export interface SayStackOptions {
    maxLines?: number;
    lineDurationMs?: number;
}

export const SAY_STACK_MAX_LINES = 3;
export const SAY_STACK_LINE_DURATION_MS = 5000;

interface TimedLine {
    line: SayStackLine;
    timer: ReturnType<typeof setTimeout>;
}

export class SayStack {
    private readonly maxLines: number;
    private readonly lineDurationMs: number;
    private readonly timedLines: TimedLine[] = [];
    private currentThought: string | undefined = undefined;
    private nextId = 1;
    private destroyed = false;

    constructor(private readonly view: SayStackView, options: SayStackOptions = {}) {
        this.maxLines = Math.max(1, options.maxLines ?? SAY_STACK_MAX_LINES);
        this.lineDurationMs = options.lineDurationMs ?? SAY_STACK_LINE_DURATION_MS;
    }

    /**
     * Adds a Say line, or (with an empty text) removes the lines that are past their lifetime.
     */
    public say(text: string): void {
        if (this.destroyed) {
            return;
        }
        if (!text) {
            this.removeExpiredLines();
            return;
        }

        this.think("");

        const line: SayStackLine = { id: this.nextId++, text, drawnAt: Date.now() };
        const timer = setTimeout(() => this.removeLine(line.id, "expired"), this.lineDurationMs);
        this.timedLines.push({ line, timer });
        this.view.addLine(line);

        while (this.timedLines.length > this.maxLines) {
            this.removeLine(this.timedLines[0].line.id, "evicted");
        }
    }

    /**
     * Shows (or replaces) the thought, or removes it when the text is empty.
     */
    public think(text: string): void {
        if (this.destroyed) {
            return;
        }
        if (this.currentThought !== undefined) {
            this.currentThought = undefined;
            this.view.hideThought();
        }
        if (text) {
            this.currentThought = text;
            this.view.showThought(text);
        }
    }

    /**
     * Removes every line and the thought, and stops every timer.
     */
    public clear(): void {
        for (const { line } of [...this.timedLines]) {
            this.removeLine(line.id, "cleared");
        }
        if (this.currentThought !== undefined) {
            this.currentThought = undefined;
            this.view.hideThought();
        }
    }

    /**
     * Stops every timer. After this, the stack ignores every call. The view is not notified:
     * its owner is expected to tear it down.
     */
    public destroy(): void {
        for (const { timer } of this.timedLines) {
            clearTimeout(timer);
        }
        this.timedLines.length = 0;
        this.currentThought = undefined;
        this.destroyed = true;
    }

    public get lines(): readonly SayStackLine[] {
        return this.timedLines.map(({ line }) => line);
    }

    public get thought(): string | undefined {
        return this.currentThought;
    }

    public get isEmpty(): boolean {
        return this.timedLines.length === 0 && this.currentThought === undefined;
    }

    /** Number of line timers still pending (for tests and leak checks). */
    public get pendingTimerCount(): number {
        return this.timedLines.length;
    }

    private removeExpiredLines(): void {
        const now = Date.now();
        for (const { line } of [...this.timedLines]) {
            if (now - line.drawnAt >= this.lineDurationMs) {
                this.removeLine(line.id, "expired");
            }
        }
    }

    private removeLine(id: number, reason: SayStackRemovalReason): void {
        const index = this.timedLines.findIndex(({ line }) => line.id === id);
        if (index === -1) {
            return;
        }
        const [{ line, timer }] = this.timedLines.splice(index, 1);
        clearTimeout(timer);
        this.view.removeLine(line, reason);
    }
}
