import { get, writable } from "svelte/store";
import { describe, expect, it } from "vitest";
import { visitingCaptionStore } from "../BrickVisitCaption";

const english = { chat: { brick: { visitingWith: ({ name }: { name: string }) => `with ${name}` } } };
const arabic = { chat: { brick: { visitingWith: ({ name }: { name: string }) => `مع ${name}` } } };

describe("the caption of a Brick that visits (#2005)", () => {
    it("is rebuilt in the new language when the language changes, with no change to the user list", () => {
        const users = writable(new Map([["u1", { uuid: "bot-1", tags: ["visiting:Sara"] }]]));
        const words = writable(english);
        const caption = visitingCaptionStore(users, words, "bot-1");
        const seen: (string | undefined)[] = [];
        const stop = caption.subscribe((value) => seen.push(value));
        expect(seen.at(-1)).toBe("with Sara");

        words.set(arabic);

        expect(seen.at(-1)).toBe("مع Sara");
        stop();
    });

    it("follows the tags of a listed user and goes away when the visit ends", () => {
        const user = { uuid: "bot-1", tags: [] as string[] };
        const users = writable(new Map([["u1", user]]));
        const caption = visitingCaptionStore(users, writable(english), "bot-1");
        // One subscription for the whole visit: what a person looking at it would see, change by change
        const seen: (string | undefined)[] = [];
        const stop = caption.subscribe((value) => seen.push(value));
        user.tags = ["visiting:Omar"];
        users.update((map) => map);
        user.tags = [];
        users.update((map) => map);
        expect(seen).toEqual([undefined, "with Omar", undefined]);
        stop();
    });

    it("says nothing for another bot or before the list is there", () => {
        const users = writable<Map<string, { uuid?: string; tags?: string[] }> | undefined>(undefined);
        const caption = visitingCaptionStore(users, writable(english), "bot-1");
        expect(get(caption)).toBeUndefined();
        users.set(new Map([["u2", { uuid: "bot-2", tags: ["visiting:Sara"] }]]));
        expect(get(caption)).toBeUndefined();
    });
});
