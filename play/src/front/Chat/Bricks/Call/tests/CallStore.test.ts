import { get } from "svelte/store";
import { describe, expect, it } from "vitest";
import { createCallStore } from "../CallStore";

describe("the one call a person has", () => {
    it("starts one call and refuses a second while it is live", () => {
        let now = 1000;
        const store = createCallStore(() => now);
        expect(store.start("brick-1", "Brick")).toBe(true);
        now = 5000;
        expect(store.start("bot-2", "Melody")).toBe(false);
        expect(get(store)).toMatchObject({ botId: "brick-1", state: { startedAt: 1000 } });
    });

    it("lets a new call start once the last one ended or was cleared", () => {
        const store = createCallStore(() => 1);
        store.start("brick-1", "Brick");
        store.send({ type: "end", by: "you" });
        expect(store.start("bot-2", "Melody")).toBe(true);
        store.clear();
        expect(get(store)).toBeUndefined();
    });

    it("moves only through the call rules", () => {
        const store = createCallStore(() => 1);
        store.start("brick-1", "Brick");
        store.send({ type: "connected", now: 2 });
        store.send({ type: "someone-here", id: "u1", name: "Sara" });
        store.send({ type: "hold-and-talk" });
        expect(get(store)?.state.phase).toBe("hold");
        store.send({ type: "resume", now: 3 });
        expect(get(store)?.state.phase).toBe("on");
    });
});
