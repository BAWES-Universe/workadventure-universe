import { describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import type { DirectPartner } from "../DirectPartnerStore";

const actions = vi.hoisted(() => ({ walkToPartner: vi.fn() }));
vi.mock("../PartnerActions", () => actions);
const navigation = vi.hoisted(() => ({ goToPersonRoom: vi.fn() }));
vi.mock("../../../UserList/PersonNavigation", () => navigation);

import { partnerNowIn, personNowIn, sameRoom, visitPerson } from "../PartnerNowIn";

const GAME = "https://play.example";
const ADA = "uuid-ada";
const LOBBY = {
    roomId: "r1",
    name: "Lobby",
    playPath: "/@/bawes/hq/lobby",
    world: { name: "BAWES HQ" },
    universe: { name: "BAWES" },
};
const view = (people: unknown[]) => ({ people });

async function settle<T>(store: { subscribe: (run: (value: T) => void) => () => void }): Promise<T> {
    let value!: T;
    const stop = store.subscribe((next) => (value = next));
    await Promise.resolve();
    await Promise.resolve();
    stop();
    return value;
}

function partner(overrides: Partial<DirectPartner> = {}): DirectPartner {
    return {
        chatId: "@ada:chat.example.com",
        user: undefined,
        uuid: ADA,
        place: { kind: "away" } as unknown as DirectPartner["place"],
        actions: { walkTo: false, locate: false },
        isBot: false,
        isBlocked: false,
        isGameBlocked: false,
        ...overrides,
    };
}

describe("personNowIn", () => {
    it("names the room a person is in, with its world and universe, on this game", () => {
        expect(personNowIn(view([{ uuid: ADA, place: LOBBY }]), ADA, GAME)).toEqual({
            url: "https://play.example/@/bawes/hq/lobby",
            room: "Lobby",
            world: "BAWES HQ",
            universe: "BAWES",
        });
    });

    it("says nothing when the view leaves them out, or only has you", () => {
        expect(personNowIn(view([]), ADA, GAME)).toBeUndefined();
        expect(personNowIn(view([{ uuid: ADA, you: true, place: LOBBY }]), ADA, GAME)).toBeUndefined();
        expect(personNowIn(view([{ uuid: ADA }]), ADA, GAME)).toBeUndefined();
        expect(personNowIn(null, ADA, GAME)).toBeUndefined();
    });

    it("never leaves this game, and wants a room name", () => {
        const away = { ...LOBBY, playPath: "https://elsewhere.example/@/bawes/hq/lobby" };
        expect(personNowIn(view([{ uuid: ADA, place: away }]), ADA, GAME)).toBeUndefined();
        expect(
            personNowIn(view([{ uuid: ADA, place: { ...LOBBY, playPath: "//evil.example/@/x" } }]), ADA, GAME)
        ).toBeUndefined();
        expect(personNowIn(view([{ uuid: ADA, place: { ...LOBBY, name: "  " } }]), ADA, GAME)).toBeUndefined();
    });
});

describe("partnerNowIn", () => {
    it("asks Orbit once for a person, and nothing for a bot or an unknown account", async () => {
        const ask = vi.fn(() => Promise.resolve(view([{ uuid: ADA, place: LOBBY }])));
        expect((await settle(partnerNowIn(ADA, ask, GAME)))?.room).toBe("Lobby");
        expect(ask).toHaveBeenCalledTimes(1);
        const none = vi.fn(() => Promise.resolve(null));
        expect(get(partnerNowIn(undefined, none, GAME))).toBeUndefined();
        expect(none).not.toHaveBeenCalled();
    });

    it("shows nothing when Orbit can't answer", async () => {
        const failed = vi.spyOn(console, "error").mockImplementation(() => undefined);
        expect(await settle(partnerNowIn("uuid-new", () => Promise.reject(new Error("down")), GAME))).toBeUndefined();
        failed.mockRestore();
    });

    it("shows the room seen last at once when the profile opens again, and asks again (#1585)", async () => {
        const uuid = "uuid-again";
        await settle(partnerNowIn(uuid, () => Promise.resolve(view([{ uuid, place: LOBBY }])), GAME));
        const garden = { ...LOBBY, name: "Garden", playPath: "/@/bawes/hq/garden" };
        const ask = vi.fn(() => Promise.resolve(view([{ uuid, place: garden }])));
        const again = partnerNowIn(uuid, ask, GAME);
        expect(get(again)?.room).toBe("Lobby");
        expect((await settle(again))?.room).toBe("Garden");
        expect(ask).toHaveBeenCalledTimes(2);
    });

    it("keeps the room seen last when Orbit doesn't answer, and drops it when Orbit says they're not shown", async () => {
        const uuid = "uuid-keep";
        await settle(partnerNowIn(uuid, () => Promise.resolve(view([{ uuid, place: LOBBY }])), GAME));
        expect((await settle(partnerNowIn(uuid, () => Promise.resolve(null), GAME)))?.room).toBe("Lobby");
        const failed = vi.spyOn(console, "error").mockImplementation(() => undefined);
        expect((await settle(partnerNowIn(uuid, () => Promise.reject(new Error("down")), GAME)))?.room).toBe("Lobby");
        failed.mockRestore();
        expect(await settle(partnerNowIn(uuid, () => Promise.resolve(view([])), GAME))).toBeUndefined();
        expect(
            get(
                partnerNowIn(
                    uuid,
                    () =>
                        new Promise<never>(() => {
                            // Never answers.
                        }),
                    GAME
                )
            )
        ).toBeUndefined();
    });
});

describe("sameRoom", () => {
    it("matches the same room however its path is spelled, and nothing when either is unknown", () => {
        expect(sameRoom("https://play.example/@/bawes/hq/my%20room", "https://play.example/@/bawes/hq/my room/")).toBe(
            true
        );
        expect(sameRoom("https://play.example/@/bawes/hq/lobby", "https://play.example/@/bawes/hq/garden")).toBe(false);
        expect(sameRoom(undefined, "https://play.example/@/bawes/hq/lobby")).toBe(false);
        expect(sameRoom("not a url", "not a url")).toBe(false);
    });
});

describe("visitPerson", () => {
    const link = { url: "https://play.example/@/bawes/hq/lobby", room: "Lobby", world: "BAWES HQ", universe: "BAWES" };

    it("walks to them while they're in this world", () => {
        const here = partner({ actions: { walkTo: true, locate: true } });
        visitPerson(here, link);
        expect(actions.walkToPartner).toHaveBeenCalledWith(here);
        expect(navigation.goToPersonRoom).not.toHaveBeenCalled();
    });

    it("goes to their room and to them there when they're elsewhere", () => {
        actions.walkToPartner.mockClear();
        visitPerson(partner(), link);
        expect(navigation.goToPersonRoom).toHaveBeenCalledWith({ uuid: ADA, playUri: link.url });
        expect(actions.walkToPartner).not.toHaveBeenCalled();
    });
});
