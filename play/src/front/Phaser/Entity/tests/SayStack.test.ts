import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SayStackLine, SayStackRemovalReason, SayStackView } from "../SayStack";
import { SayStack } from "../SayStack";
import { SayStackDomView } from "../SayStackView";

class RecordingView implements SayStackView {
    public readonly shown: string[] = [];
    public thought: string | undefined;
    public readonly removals: { text: string; reason: SayStackRemovalReason }[] = [];

    addLine(line: SayStackLine): void {
        this.shown.push(line.text);
    }
    removeLine(line: SayStackLine, reason: SayStackRemovalReason): void {
        const index = this.shown.indexOf(line.text);
        if (index !== -1) this.shown.splice(index, 1);
        this.removals.push({ text: line.text, reason });
    }
    showThought(text: string): void {
        this.thought = text;
    }
    hideThought(): void {
        this.thought = undefined;
    }
}

describe("SayStack", () => {
    let view: RecordingView;
    let stack: SayStack;

    beforeEach(() => {
        vi.useFakeTimers();
        view = new RecordingView();
        stack = new SayStack(view);
    });

    afterEach(() => {
        stack.destroy();
        vi.useRealTimers();
    });

    it("keeps two quick lines, newest last", () => {
        stack.say("one");
        stack.say("two");
        expect(stack.lines.map((l) => l.text)).toEqual(["one", "two"]);
        expect(view.shown).toEqual(["one", "two"]);
    });

    it("caps at three lines and removes the oldest", () => {
        stack.say("1");
        stack.say("2");
        stack.say("3");
        stack.say("4");
        expect(stack.lines.map((l) => l.text)).toEqual(["2", "3", "4"]);
        expect(view.shown).toEqual(["2", "3", "4"]);
        expect(view.removals).toEqual([{ text: "1", reason: "evicted" }]);
        expect(stack.pendingTimerCount).toBe(3);
        expect(vi.getTimerCount()).toBe(3);
    });

    it("expires each line on its own timer", () => {
        stack.say("first");
        vi.advanceTimersByTime(2000);
        stack.say("second");
        vi.advanceTimersByTime(2999);
        expect(view.shown).toEqual(["first", "second"]);
        vi.advanceTimersByTime(1);
        expect(view.shown).toEqual(["second"]);
        vi.advanceTimersByTime(1999);
        expect(view.shown).toEqual(["second"]);
        vi.advanceTimersByTime(1);
        expect(view.shown).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("an empty Say leaves lines younger than 5s", () => {
        stack.say("old");
        vi.advanceTimersByTime(3000);
        stack.say("new");
        stack.say("");
        expect(view.shown).toEqual(["old", "new"]);
    });

    it("an empty Say removes lines past their lifetime even if their timer was delayed", () => {
        stack.say("old");
        vi.setSystemTime(Date.now() + 6000); // clock moves on, timer has not fired yet (throttled tab)
        stack.say("new");
        stack.say("");
        expect(view.shown).toEqual(["new"]);
        expect(stack.pendingTimerCount).toBe(1);
    });

    it("a new Think replaces the previous one and an empty Think clears it", () => {
        stack.think("hmm");
        stack.think("aha");
        expect(view.thought).toBe("aha");
        stack.think("");
        expect(view.thought).toBeUndefined();
        expect(stack.thought).toBeUndefined();
    });

    it("Say then Think keeps the Say line, and clearing the Think leaves it", () => {
        stack.say("hello");
        stack.think("pondering");
        expect(view.shown).toEqual(["hello"]);
        expect(view.thought).toBe("pondering");
        stack.think(""); // what the player's move sends
        expect(view.shown).toEqual(["hello"]);
        expect(view.thought).toBeUndefined();
    });

    it("Think then Say replaces the thought with the line", () => {
        stack.think("pondering");
        stack.say("hello");
        expect(view.thought).toBeUndefined();
        expect(view.shown).toEqual(["hello"]);
    });

    it("an empty Say does not clear the thought", () => {
        stack.think("pondering");
        stack.say("");
        expect(view.thought).toBe("pondering");
    });

    it("clear removes everything and stops every timer", () => {
        stack.say("a");
        stack.say("b");
        stack.think("c");
        stack.clear();
        expect(view.shown).toEqual([]);
        expect(view.thought).toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
        expect(stack.isEmpty).toBe(true);
    });

    it("destroy leaves no timer and ignores later calls", () => {
        stack.say("a");
        stack.say("b");
        stack.say("c");
        stack.destroy();
        expect(vi.getTimerCount()).toBe(0);
        expect(stack.pendingTimerCount).toBe(0);
        stack.say("late");
        stack.think("late");
        expect(vi.getTimerCount()).toBe(0);
        expect(view.shown).toEqual(["a", "b", "c"]);
        expect(view.thought).toBeUndefined();
    });
});

describe("SayStack with the DOM view", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("draws say-bubble and thinking-cloud elements, newest at the bottom", () => {
        const view = new SayStackDomView();
        document.body.appendChild(view.getElement());
        const stack = new SayStack(view);

        stack.say("1");
        stack.say("2");
        stack.say("3");
        stack.say("4");
        vi.advanceTimersByTime(500); // let the evicted line fade out
        const bubbles = Array.from(view.getElement().querySelectorAll(".say-bubble")).map((el) => el.textContent);
        expect(bubbles).toEqual(["2", "3", "4"]);

        stack.think("hmm");
        expect(view.getElement().querySelectorAll(".thinking-cloud")).toHaveLength(1);
        stack.think("");
        vi.advanceTimersByTime(500);
        expect(view.getElement().querySelectorAll(".thinking-cloud")).toHaveLength(0);

        stack.destroy();
        view.destroy();
    });

    it("destroying removes every timer and DOM element", () => {
        const view = new SayStackDomView();
        document.body.appendChild(view.getElement());
        const stack = new SayStack(view);

        stack.say("a");
        stack.say("b");
        stack.say("c");
        stack.say("d"); // "a" is fading out, with its own leave timer
        stack.think("e");
        stack.think(""); // the cloud is fading out too

        stack.destroy();
        view.destroy();

        expect(vi.getTimerCount()).toBe(0);
        expect(document.querySelectorAll(".say-stack-anchor, .say-bubble, .thinking-cloud")).toHaveLength(0);
    });
});
