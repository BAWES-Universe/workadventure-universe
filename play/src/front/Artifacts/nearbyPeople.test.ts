import { describe, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";

const scene = vi.hoisted(() => ({ store: undefined as unknown }));
vi.mock("../Stores/GameSceneStore", async () => {
    const { writable } = await import("svelte/store");
    scene.store = writable(undefined);
    return { gameSceneStore: scene.store };
});

import { nearbyPeopleNames } from "./nearbyPeople";

function person(name: string, bot = false) {
    return { id: name, name, pictureStore: writable(undefined), bot };
}

function enter(spaceName: string | undefined, participants: ReturnType<typeof person>[]) {
    const room = { currentSpaceName: spaceName, participants: writable(participants) };
    (scene.store as ReturnType<typeof writable>).set({ proximityChatRoom: room });
    return room;
}

describe("the people a Share menu names", () => {
    it("are the people with you in that nearby chat, without its bots", () => {
        enter("bubble", [person("Laura"), person("Scout", true), person(" Sam "), person("Omar")]);
        expect(get(nearbyPeopleNames("bubble"))).toEqual(["Laura", "Sam", "Omar"]);
    });

    it("follow people coming and going", () => {
        const room = enter("bubble", [person("Laura")]);
        const names = nearbyPeopleNames("bubble");
        const seen: string[][] = [];
        const stop = names.subscribe((value) => seen.push(value));
        room.participants.set([person("Laura"), person("Sam")]);
        stop();
        expect(seen).toEqual([["Laura"], ["Laura", "Sam"]]);
    });

    it("are nobody once this tab is in another chat, or none", () => {
        enter("other-bubble", [person("Laura")]);
        expect(get(nearbyPeopleNames("bubble"))).toEqual([]);
        enter(undefined, []);
        expect(get(nearbyPeopleNames("bubble"))).toEqual([]);
        (scene.store as ReturnType<typeof writable>).set(undefined);
        expect(get(nearbyPeopleNames("bubble"))).toEqual([]);
    });
});
