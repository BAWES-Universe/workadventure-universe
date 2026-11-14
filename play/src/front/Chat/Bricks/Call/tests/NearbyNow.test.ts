import { describe, expect, it } from "vitest";
import { get, writable } from "svelte/store";
import { nearbyNowOf } from "../NearbyNow";

describe("who is with the person now", () => {
    it("lists people only, in the game's order, and the kind of place", () => {
        const participants = writable([
            { id: "a", name: " Ana ", bot: false },
            { id: "bot", name: "Nora", bot: true },
            { id: "b", name: "", bot: false },
        ]);
        const spaceKind = writable<"none" | "bubble" | "meeting" | "stream">("bubble");
        const now = nearbyNowOf({ participants, spaceKind });
        expect(get(now)).toEqual({
            kind: "bubble",
            people: [
                { id: "a", name: "Ana" },
                { id: "b", name: "b" },
            ],
        });
        spaceKind.set("meeting");
        expect(get(now).kind).toBe("meeting");
    });

    it("leaves out another tab or device of the person's own account", () => {
        const participants = writable([
            { id: "tab2", name: "Khalid", bot: false, uuid: "me" },
            { id: "tab3", name: "Khalid", bot: false, chatId: "@me:x" },
            { id: "sara", name: "Sara", bot: false, uuid: "sara", chatId: "@sara:x" },
        ]);
        const now = nearbyNowOf({ participants, spaceKind: writable("bubble") }, () => ({
            uuid: "me",
            chatId: "@me:x",
        }));
        expect(get(now).people).toEqual([{ id: "sara", name: "Sara" }]);
    });
});
