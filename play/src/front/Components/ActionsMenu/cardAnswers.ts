/**
 * Answers a person's card waits for (Orbit's membership button, a bot's Summon), kept per person for the session so
 * a card opened again shows its buttons at once (#1790). One question per person at a time: a second look while the
 * first is on its way shares its answer.
 */
export class CardAnswers<T> {
    private kept = new Map<string, { value: T; until: number }>();
    private asking = new Map<string, Promise<T>>();

    /**
     * @param ask Finds the answer out.
     * @param keptFor How long (ms) an answer stays: forever by default. A "nothing" that may only mean Orbit did not
     *   answer is worth keeping for less.
     */
    constructor(
        private ask: (key: string) => Promise<T>,
        private keptFor: (value: T) => number = () => Infinity,
        private now: () => number = Date.now
    ) {}

    /** The answer, from memory when it is still good. A question that fails is not kept: the next look asks again. */
    get(key: string): Promise<T> {
        const known = this.kept.get(key);
        if (known && known.until > this.now()) return Promise.resolve(known.value);
        const running = this.asking.get(key);
        if (running) return running;
        const asked = this.ask(key)
            .then((value) => {
                this.kept.set(key, { value, until: this.now() + this.keptFor(value) });
                return value;
            })
            .finally(() => {
                this.asking.delete(key);
            });
        this.asking.set(key, asked);
        return asked;
    }

    /** What changed (membership given, a bot's setting): the next look asks again. */
    forget(key: string): void {
        this.kept.delete(key);
    }
}
