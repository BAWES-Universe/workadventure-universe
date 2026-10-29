import { describe, expect, it, vi } from "vitest";
import type { Writable } from "svelte/store";
import type { Relationship } from "../FriendsStore";

const { relationships } = vi.hoisted(() => ({ relationships: { store: undefined as unknown } }));
vi.mock("../FriendsStore", async () => {
    const { writable } = await import("svelte/store");
    relationships.store = writable(new Map());
    return { relationshipsStore: relationships.store };
});

import { forgetPerson, profileMemory } from "../ProfileMemory";

const standing = () => relationships.store as Writable<Map<string, Relationship>>;

describe("what a profile showed last", () => {
    it("is kept per person, for every kind of thing a profile shows", () => {
        const cards = profileMemory<string>();
        const rooms = profileMemory<string | undefined>();
        cards.set("ada", "Builds worlds");
        rooms.set("ada", undefined);
        expect(cards.get("ada")).toBe("Builds worlds");
        expect(rooms.has("ada")).toBe(true);
        expect(cards.has("bob")).toBe(false);
    });

    it("forgets one person everywhere, and no one else", () => {
        const cards = profileMemory<string>();
        const rooms = profileMemory<string>();
        cards.set("ada", "card");
        rooms.set("ada", "Lobby");
        cards.set("bob", "card");
        forgetPerson("ada");
        expect(cards.has("ada")).toBe(false);
        expect(rooms.has("ada")).toBe(false);
        expect(cards.get("bob")).toBe("card");
    });

    it("forgets someone whose standing with you changes, so nothing they show only to friends stays", () => {
        const cards = profileMemory<string>();
        standing().set(new Map([["ada", "friends"]]));
        cards.set("ada", "friends-only stamps");
        cards.set("bob", "card");
        // The list read again with nothing changed keeps everyone.
        standing().set(new Map([["ada", "friends"]]));
        expect(cards.has("ada")).toBe(true);
        // Unfriended.
        standing().set(new Map());
        expect(cards.has("ada")).toBe(false);
        // Blocked.
        cards.set("bob", "card");
        standing().set(new Map([["bob", "blocked_by_me"]]));
        expect(cards.has("bob")).toBe(false);
    });
});
