import { beforeEach, describe, expect, it } from "vitest";
import { singlePlayback } from "../SinglePlayback";

/** jsdom does not play media: this stands in for an element that fires the events a browser would. */
function makeElement() {
    const element = document.createElement("audio");
    let paused = true;
    Object.defineProperty(element, "paused", { get: () => paused });
    element.pause = () => {
        if (paused) return;
        paused = true;
        element.dispatchEvent(new Event("pause"));
    };
    const play = () => {
        paused = false;
        element.dispatchEvent(new Event("play"));
    };
    return { element, play };
}

describe("one thing playing at a time", () => {
    let first: ReturnType<typeof makeElement>;
    let second: ReturnType<typeof makeElement>;
    let third: ReturnType<typeof makeElement>;
    let actions: { destroy: () => void }[];

    beforeEach(() => {
        first = makeElement();
        second = makeElement();
        third = makeElement();
        actions = [first, second, third].map(({ element }) => singlePlayback(element));
        return () => actions.forEach((action) => action.destroy());
    });

    it("pauses the one playing when another starts", () => {
        first.play();
        second.play();

        expect(first.element.paused).toBe(true);
        expect(second.element.paused).toBe(false);

        third.play();
        expect(second.element.paused).toBe(true);
        expect(third.element.paused).toBe(false);
    });

    it("leaves an element alone that is not opted in", () => {
        const game = makeElement();
        first.play();
        game.play();

        expect(first.element.paused).toBe(false);
        expect(game.element.paused).toBe(false);
    });

    it("does not pause anything when the one playing is paused or has ended", () => {
        first.play();
        first.element.pause();
        second.play();
        second.element.dispatchEvent(new Event("ended"));
        third.play();

        expect(third.element.paused).toBe(false);
    });

    it("pauses an element that goes away while playing, and frees the turn", () => {
        first.play();
        actions[0].destroy();

        expect(first.element.paused).toBe(true);

        second.play();
        expect(second.element.paused).toBe(false);
    });
});
