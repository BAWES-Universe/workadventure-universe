import { describe, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";

vi.mock("../../../Chat/Stores/FriendsStore", () => ({ relationshipsStore: writable(new Map()) }));

import { orbitProfileUuid, parseProfileCard, profileCardStore } from "../ProfileCard";

const ORBIT = "https://orbit.example";
const GAME = "https://play.example/";
const ANSWER = {
    name: "Ada",
    bio: "Builds worlds",
    links: [
        { label: "Site", url: "https://bawes.net" },
        { label: "Bad", url: "javascript:alert(1)" },
    ],
    stamps: [
        { world: "HQ", visits: 212, colour: "#8b5cf6", long: null },
        { world: "Experimental", visits: 1, colour: "red;background:url(x)", long: "longer" },
    ],
};

async function settle<T>(store: { subscribe: (run: (value: T) => void) => () => void }): Promise<T> {
    let value!: T;
    const stop = store.subscribe((next) => (value = next));
    await Promise.resolve();
    await Promise.resolve();
    stop();
    return value;
}

describe("orbitProfileUuid", () => {
    it("knows an Orbit profile card by its address, and nothing else", () => {
        expect(orbitProfileUuid(`${ORBIT}/api/profile/uuid-ada?embed=true`, ORBIT, GAME)).toBe("uuid-ada");
        expect(orbitProfileUuid(`${ORBIT}/api/profile/a%20b?embed=true`, ORBIT, GAME)).toBe("a b");
        expect(orbitProfileUuid("https://elsewhere.example/api/profile/uuid-ada", ORBIT, GAME)).toBeUndefined();
        expect(orbitProfileUuid(`${ORBIT}/admin/you`, ORBIT, GAME)).toBeUndefined();
        expect(orbitProfileUuid(`${ORBIT}/api/profile/uuid-ada`, null, GAME)).toBeUndefined();
        expect(orbitProfileUuid("::", ORBIT, GAME)).toBeUndefined();
    });
});

describe("parseProfileCard", () => {
    it("keeps the words, web links only, and stamps with a colour that can only be a colour", () => {
        expect(parseProfileCard(ANSWER)).toEqual({
            bio: "Builds worlds",
            links: [{ label: "Site", url: "https://bawes.net" }],
            stamps: [
                { world: "HQ", visits: 212, colour: "#8b5cf6", long: undefined },
                { world: "Experimental", visits: 1, colour: "#8b5cf6", long: "longer" },
            ],
        });
    });

    it("has nothing to show for someone who wrote nothing, and is no card for anything else", () => {
        expect(parseProfileCard({ bio: "  ", links: [], stamps: [] })).toBeNull();
        expect(parseProfileCard(null)).toBeUndefined();
        expect(parseProfileCard("<html>")).toBeUndefined();
    });
});

describe("profileCardStore", () => {
    it("loads the first time, then shows the card kept at once while it asks again (#1585)", async () => {
        const ask = vi.fn(() => Promise.resolve<unknown>(ANSWER));
        const first: unknown[] = [];
        const stopFirst = profileCardStore("ada", ask).subscribe((state) => first.push(state));
        await Promise.resolve();
        await Promise.resolve();
        stopFirst();
        expect(first).toEqual([{ kind: "loading" }, { kind: "card", card: parseProfileCard(ANSWER) }]);

        const edited = { ...ANSWER, bio: "Builds bigger worlds" };
        ask.mockResolvedValue(edited);
        const again = profileCardStore("ada", ask);
        const shown: unknown[] = [];
        const stop = again.subscribe((state) => shown.push(state));
        await Promise.resolve();
        await Promise.resolve();
        stop();
        expect(shown).toEqual([
            { kind: "card", card: parseProfileCard(ANSWER) },
            { kind: "card", card: parseProfileCard(edited) },
        ]);
        expect(ask).toHaveBeenCalledTimes(2);
    });

    it("shows nothing again when the card is the same", async () => {
        const ask = vi.fn(() => Promise.resolve<unknown>(ANSWER));
        await settle(profileCardStore("same", ask));
        const shown: unknown[] = [];
        const stop = profileCardStore("same", ask).subscribe((state) => shown.push(state));
        await Promise.resolve();
        await Promise.resolve();
        stop();
        expect(shown).toHaveLength(1);
    });

    it("keeps the card when Orbit doesn't answer, and falls back to Orbit's page when nothing was kept", async () => {
        await settle(profileCardStore("kept", () => Promise.resolve<unknown>(ANSWER)));
        expect((await settle(profileCardStore("kept", () => Promise.resolve(undefined)))).kind).toBe("card");
        expect(await settle(profileCardStore("never", () => Promise.resolve(undefined)))).toEqual({ kind: "frame" });
        const failed = vi.spyOn(console, "error").mockImplementation(() => undefined);
        expect(await settle(profileCardStore("down", () => Promise.reject(new Error("down"))))).toEqual({
            kind: "frame",
        });
        failed.mockRestore();
    });

    it("keeps that someone has no profile, so their card takes no room next time", async () => {
        expect(await settle(profileCardStore("empty", () => Promise.resolve(null)))).toEqual({
            kind: "card",
            card: null,
        });
        expect(
            get(
                profileCardStore(
                    "empty",
                    () =>
                        new Promise<never>(() => {
                            // Never answers.
                        })
                )
            )
        ).toEqual({ kind: "card", card: null });
    });
});
