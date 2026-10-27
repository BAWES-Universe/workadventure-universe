/** While keys keep coming, "typing" is said again this often (ms), so the other side never times it out. */
export const TYPING_REFRESH_MS = 4000;
/** This long without a key (ms) and "stopped" goes out on its own. */
export const TYPING_IDLE_MS = 5000;

/**
 * What the message box tells the others about typing (#1379). One idle timer, reset on every key and never waiting on
 * the server: the old one only started once the server answered, so two answers between keys lost a timer that later
 * fired "stopped" mid-sentence and made the dots blink. "Typing" goes out once, then every TYPING_REFRESH_MS, instead of
 * on every key.
 */
export class TypingSignal {
    private typing = false;
    private lastTypingSentAt = 0;
    private idleTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private readonly send: (typing: boolean) => void,
        private readonly now: () => number = () => Date.now()
    ) {}

    /** A key went into the box and it still holds something. */
    keyTyped(): void {
        const now = this.now();
        if (!this.typing || now - this.lastTypingSentAt >= TYPING_REFRESH_MS) {
            this.typing = true;
            this.lastTypingSentAt = now;
            this.send(true);
        }
        if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => this.stop(), TYPING_IDLE_MS);
    }

    /** The message was sent, the box was emptied or left: "stopped" goes out at once, only if "typing" did. */
    stop(): void {
        if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
        this.idleTimer = undefined;
        if (!this.typing) return;
        this.typing = false;
        this.send(false);
    }
}
