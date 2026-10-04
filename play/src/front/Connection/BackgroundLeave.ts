/**
 * A phone left in the background, away and alone, leaves the room after a while, and comes back in when the page is
 * on screen again.
 *
 * The server keeps someone in the room for as long as their page answers its pings. A phone normally freezes a page
 * in the background, so it stops answering and the person leaves within a few minutes. But a phone can also keep the
 * page running in the background (iOS does while it uses the microphone or plays sound), and then the person stays
 * in the room as "away" for hours, until they open the browser again. This makes the phone leave on its own after
 * BACKGROUND_LEAVE_AFTER_MS, whether the phone freezes the page or not. Calls are never cut: the time only runs while
 * the person is away and nobody is with them.
 */

/** How long a phone stays in the room in the background, away and alone. */
export const BACKGROUND_LEAVE_AFTER_MS = 5 * 60_000;

export interface BackgroundLeaveClock {
    setTimeout(handler: () => void, timeout: number): unknown;
    clearTimeout(handle: unknown): void;
}

export interface BackgroundLeaveOptions {
    /** Called once, when the person has been away and alone in the background for the whole delay. */
    leave: () => void;
    /** Whether the page is in the background right now. */
    isHidden: () => boolean;
    delay?: number;
    clock?: BackgroundLeaveClock;
}

const defaultClock: BackgroundLeaveClock = {
    setTimeout: (handler, timeout) => setTimeout(handler, timeout),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class BackgroundLeave {
    private readonly clock: BackgroundLeaveClock;
    private handle: unknown;
    private done = false;

    constructor(private readonly options: BackgroundLeaveOptions) {
        this.clock = options.clock ?? defaultClock;
    }

    /** Whether the person is away and alone in the background: the time starts, or stops. */
    public update(awayAndAlone: boolean): void {
        if (this.done) return;
        if (!awayAndAlone) {
            this.disarm();
            return;
        }
        if (this.handle !== undefined) return;
        this.handle = this.clock.setTimeout(this.fire, this.options.delay ?? BACKGROUND_LEAVE_AFTER_MS);
    }

    /** Stops for good (the room is closing). */
    public stop(): void {
        this.done = true;
        this.disarm();
    }

    private disarm(): void {
        if (this.handle === undefined) return;
        this.clock.clearTimeout(this.handle);
        this.handle = undefined;
    }

    private readonly fire = (): void => {
        this.handle = undefined;
        // A timer held up while the page slept can fire as the page comes back: the person is here, they stay.
        if (this.done || !this.options.isHidden()) return;
        this.done = true;
        this.options.leave();
    };
}

let leftInBackground = false;

/** The room was left in the background: the next connection waits for the page to be on screen. */
export function markLeftInBackground(): void {
    leftInBackground = true;
}

/**
 * Resolves when the next connection can start: at once, unless the room was left in the background and the page is
 * still there, then when the page comes back on screen.
 */
export function waitToComeBack(
    doc: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener"> = document
): Promise<void> {
    if (!leftInBackground) return Promise.resolve();
    return new Promise<void>((resolve) => {
        const check = () => {
            if (doc.visibilityState !== "visible") return;
            doc.removeEventListener("visibilitychange", check);
            leftInBackground = false;
            resolve();
        };
        doc.addEventListener("visibilitychange", check);
        check();
    });
}
