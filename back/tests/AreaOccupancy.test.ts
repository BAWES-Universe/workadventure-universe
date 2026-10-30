import { describe, expect, it } from "vitest";
import type { AreaData } from "@workadventure/map-editor";
import type { AreaPropertyVariableMessage } from "@workadventure/messages";
import { AreaOccupancy } from "../src/Model/AreaOccupancy";

type Property = AreaData["properties"][number];

// The Lounge: x 0 to 100, y 0 to 100. A player is inside when their feet (16 px below their position) are.
function lounge(properties: Property[]): AreaData {
    return { id: "lounge", name: "Lounge", x: 0, y: 0, width: 100, height: 100, visible: true, properties } as AreaData;
}
const maxPeople = (maxUsers: number | null, disabled?: boolean): Property =>
    ({ id: "max", type: "maxUsersInAreaPropertyData", maxUsers, disabled } as Property);
const lockable = (allowedTags: string[] = []): Property =>
    ({ id: "lock", type: "lockableAreaPropertyData", allowedTags } as Property);

let nextId = 1;
function player(x: number, y: number, uuid = `user-${nextId}`) {
    const position = { x, y };
    return {
        id: nextId++,
        uuid,
        tags: [] as string[],
        isLogged: true,
        permissions: 0,
        getPosition: () => position,
        moveTo(newX: number, newY: number) {
            position.x = newX;
            position.y = newY;
        },
    };
}
const INSIDE = [50, 50] as const;
const OUTSIDE = [50, 300] as const;
const INSIDE_POSITION = { x: INSIDE[0], y: INSIDE[1] };

function occupancy() {
    const sent: AreaPropertyVariableMessage[] = [];
    const counts = new AreaOccupancy((message) => sent.push(message));
    const last = () => sent[sent.length - 1]?.value;
    return { counts, sent, last };
}

describe("AreaOccupancy", () => {
    it("counts the people who walk in and out, and tells the room each time", () => {
        const { counts, sent, last } = occupancy();
        counts.setAreas([lounge([maxPeople(2)])], []);
        expect(sent).toEqual([{ areaId: "lounge", propertyId: "max", key: "usersInside", value: "0" }]);

        const sara = player(...OUTSIDE);
        counts.userMoved(sara);
        expect(sent).toHaveLength(1);

        sara.moveTo(...INSIDE);
        counts.userMoved(sara);
        expect(last()).toBe("1");

        // Moving around inside changes nothing
        sara.moveTo(60, 60);
        counts.userMoved(sara);
        expect(sent).toHaveLength(2);

        sara.moveTo(...OUTSIDE);
        counts.userMoved(sara);
        expect(last()).toBe("0");
    });

    it("counts someone who arrives inside, and forgets them when they leave the room", () => {
        const { counts, last } = occupancy();
        counts.setAreas([lounge([maxPeople(2)])], []);
        const omar = player(...INSIDE);
        counts.userMoved(omar);
        expect(last()).toBe("1");
        counts.userLeft(omar);
        expect(last()).toBe("0");
    });

    it("never counts a bot", () => {
        const { counts, sent } = occupancy();
        counts.setAreas([lounge([maxPeople(2)])], []);
        const byTag = { ...player(...INSIDE), tags: ["bot"] };
        const byUuid = player(...INSIDE, "bot-helper");
        counts.userMoved(byTag);
        counts.userMoved(byUuid);
        expect(sent).toHaveLength(1);
        expect(counts.getVariables()[0].value).toBe("0");
    });

    it("only follows areas whose Max people is on and set to 1 or more", () => {
        const { counts } = occupancy();
        counts.setAreas(
            [
                lounge([maxPeople(null)]),
                { ...lounge([maxPeople(0)]), id: "zero" },
                { ...lounge([maxPeople(3, true)]), id: "off" },
            ],
            []
        );
        expect(counts.getVariables()).toEqual([]);
    });

    it("recounts when the areas change, and only tells the room what changed", () => {
        const { counts, sent, last } = occupancy();
        const lina = player(...INSIDE);
        counts.setAreas([lounge([maxPeople(2)])], [lina]);
        expect(last()).toBe("1");

        counts.setAreas([lounge([maxPeople(5)])], [lina]);
        expect(sent).toHaveLength(1);

        // The room shrinks so that Lina is now outside it
        counts.setAreas([{ ...lounge([maxPeople(5)]), height: 10 }], [lina]);
        expect(last()).toBe("0");
    });

    it("keeps people inside and outside a full room from meeting across its edge", () => {
        const { counts } = occupancy();
        counts.setAreas([lounge([maxPeople(1)])], []);
        const inside = player(...INSIDE);
        const outside = player(50, 120);
        const alsoOutside = player(60, 120);
        counts.userMoved(inside);
        expect(counts.separatesClosedArea(inside.getPosition(), outside.getPosition())).toBe(true);
        expect(counts.separatesClosedArea(outside.getPosition(), alsoOutside.getPosition())).toBe(false);

        // Not full any more: the edge is open again
        inside.moveTo(...OUTSIDE);
        counts.userMoved(inside);
        expect(counts.separatesClosedArea(INSIDE_POSITION, outside.getPosition())).toBe(false);
    });

    describe("a lockable room (#1622)", () => {
        const lockMessages = (sent: AreaPropertyVariableMessage[]) =>
            sent.filter((message) => message.key === "lock").map((message) => message.value);

        it("is locked by someone signed in inside it, and opens by itself when the last person leaves", () => {
            const { counts, sent } = occupancy();
            counts.setAreas([lounge([lockable()])], []);
            expect(lockMessages(sent)).toEqual(["false"]);

            const sara = player(...INSIDE);
            const omar = player(...INSIDE);
            counts.userMoved(sara);
            counts.userMoved(omar);
            expect(counts.setLocked(sara, "lounge", "lock", true)).toBe(true);
            expect(lockMessages(sent)).toEqual(["false", "true"]);

            sara.moveTo(...OUTSIDE);
            counts.userMoved(sara);
            expect(lockMessages(sent)).toEqual(["false", "true"]);
            counts.userLeft(omar);
            expect(lockMessages(sent)).toEqual(["false", "true", "false"]);
        });

        it("cannot be locked from outside, by a guest, by a bot, or without one of the room's tags", () => {
            const { counts } = occupancy();
            counts.setAreas([lounge([lockable(["member"])])], []);
            const outside = { ...player(...OUTSIDE), tags: ["member"] };
            const guest = { ...player(...INSIDE), tags: ["member"], isLogged: false };
            const bot = { ...player(...INSIDE), tags: ["member", "bot"] };
            const visitor = player(...INSIDE);
            for (const someone of [outside, guest, bot, visitor]) counts.userMoved(someone);

            expect(counts.setLocked(outside, "lounge", "lock", true)).toBe(false);
            expect(counts.setLocked(guest, "lounge", "lock", true)).toBe(false);
            expect(counts.setLocked(bot, "lounge", "lock", true)).toBe(false);
            expect(counts.setLocked(visitor, "lounge", "lock", true)).toBe(false);

            const member = { ...player(...INSIDE), tags: ["member"] };
            counts.userMoved(member);
            expect(counts.setLocked(member, "lounge", "wrong-property", true)).toBe(false);
            expect(counts.setLocked(member, "lounge", "lock", true)).toBe(true);
        });

        it("lets the Owner and Admins unlock it from outside, but not lock it from there", () => {
            const { counts } = occupancy();
            counts.setAreas([lounge([lockable(["member"])])], []);
            const member = { ...player(...INSIDE), tags: ["member"] };
            const admin = { ...player(...OUTSIDE), permissions: 16383 };
            counts.userMoved(member);
            counts.userMoved(admin);

            expect(counts.setLocked(admin, "lounge", "lock", true)).toBe(false);
            expect(counts.setLocked(member, "lounge", "lock", true)).toBe(true);
            expect(counts.setLocked(admin, "lounge", "lock", false)).toBe(true);
        });

        it("keeps people inside and outside a locked room from meeting across its edge", () => {
            const { counts } = occupancy();
            counts.setAreas([lounge([lockable()])], []);
            const inside = player(...INSIDE);
            counts.userMoved(inside);
            expect(counts.separatesClosedArea(INSIDE_POSITION, { x: 50, y: 120 })).toBe(false);
            counts.setLocked(inside, "lounge", "lock", true);
            expect(counts.separatesClosedArea(INSIDE_POSITION, { x: 50, y: 120 })).toBe(true);
        });

        it("stays locked through an edit of its area while someone is inside, and tells a newcomer", () => {
            const { counts, sent } = occupancy();
            const lina = player(...INSIDE);
            counts.setAreas([lounge([lockable(), maxPeople(3)])], [lina]);
            counts.setLocked(lina, "lounge", "lock", true);
            const before = sent.length;

            counts.setAreas([{ ...lounge([lockable(), maxPeople(4)]), name: "Big lounge" }], [lina]);
            expect(sent).toHaveLength(before);
            expect(counts.getVariables()).toEqual([
                { areaId: "lounge", propertyId: "max", key: "usersInside", value: "1" },
                { areaId: "lounge", propertyId: "lock", key: "lock", value: "true" },
            ]);
        });
    });
});
