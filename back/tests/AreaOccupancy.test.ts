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

let nextId = 1;
function player(x: number, y: number, uuid = `user-${nextId}`) {
    const position = { x, y };
    return {
        id: nextId++,
        uuid,
        tags: [] as string[],
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
        expect(counts.separatesFullArea(inside.getPosition(), outside.getPosition())).toBe(true);
        expect(counts.separatesFullArea(outside.getPosition(), alsoOutside.getPosition())).toBe(false);

        // Not full any more: the edge is open again
        inside.moveTo(...OUTSIDE);
        counts.userMoved(inside);
        expect(counts.separatesFullArea(INSIDE_POSITION, outside.getPosition())).toBe(false);
    });
});
