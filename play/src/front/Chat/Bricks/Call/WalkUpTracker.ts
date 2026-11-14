import type { CallState } from "./CallSession";

/** Someone in the nearby bubble, by their id in it (never a bot: bots are not asked about). */
export interface Nearby {
    id: string;
    name: string;
}

/**
 * Who has walked up while the person is on a call (game #2004, mock v10 Part 18 picture 10).
 *
 * Whoever is already in the bubble when the call starts is not new, and neither is anyone the person has answered (a
 * card tapped "Not now", or everyone in the bubble when they chose "Hold call and talk"). Someone who leaves and comes
 * back has walked up again. Only people the game lists are looked at, so nothing here depends on who is nearest or how
 * far anyone is: everyone counts the same.
 *
 * Pure bookkeeping, so it is tested without a game. The reducer in CallSession keeps the rule of one card at a time;
 * this decides who the next card is for.
 */
export function createWalkUpTracker() {
    const answered = new Set<string>();

    return {
        /** The call begins: whoever is here now is not new. */
        start(present: readonly Nearby[]): void {
            answered.clear();
            for (const person of present) answered.add(person.id);
        },
        /** The person to ask about now, or undefined: nobody new, a card already showing, or a call that is not on. */
        next(present: readonly Nearby[], state: CallState): Nearby | undefined {
            // Someone who left is forgotten, so coming back is walking up again
            for (const id of [...answered]) if (!present.some((person) => person.id === id)) answered.delete(id);
            if (state.phase !== "on" || state.walkUp) return undefined;
            return present.find((person) => !answered.has(person.id));
        },
        /** "Not now": this person is dealt with, the next new person (if any) is asked about on their own. */
        answer(id: string): void {
            answered.add(id);
        },
        /** "Hold call and talk": everyone in the bubble is the person's to talk with, none of them is new. */
        answerAll(present: readonly Nearby[]): void {
            for (const person of present) answered.add(person.id);
        },
    };
}
