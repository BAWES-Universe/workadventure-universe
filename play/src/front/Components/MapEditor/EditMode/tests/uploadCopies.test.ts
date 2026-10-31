import { describe, expect, it } from "vitest";
import { deleteStep, describePlacedIn } from "../uploadCopies";

const OFFICE = "https://maps.example/universe/world/office/map.wam";
const LOUNGE = "https://maps.example/universe/world/lounge/map.wam";
const ATTIC = "https://maps.example/universe/world/attic/map.wam";
const names = [
    { name: "Office", wamUrl: OFFICE },
    { name: "The Lounge", wamUrl: LOUNGE },
];

describe("the box that confirms deleting an upload (#1690)", () => {
    it("deletes at once when the upload is placed nowhere", () => {
        expect(deleteStep(describePlacedIn([], names, OFFICE))).toEqual({ ask: false });
        expect(deleteStep(describePlacedIn([{ wamUrl: OFFICE, count: 0 }], names, OFFICE))).toEqual({ ask: false });
    });

    it("asks, with one row called This room, when it is placed in this room only", () => {
        const step = deleteStep(describePlacedIn([{ wamUrl: OFFICE, count: 3 }], names, OFFICE));
        expect(step).toEqual({ ask: true, total: 3, rooms: [{ name: undefined, thisRoom: true, count: 3 }] });
    });

    it("lists this room first, then the other rooms by the name people see for them", () => {
        const step = deleteStep(
            describePlacedIn(
                [
                    { wamUrl: LOUNGE, count: 2 },
                    { wamUrl: OFFICE, count: 1 },
                ],
                names,
                OFFICE
            )
        );
        expect(step).toEqual({
            ask: true,
            total: 3,
            rooms: [
                { name: undefined, thisRoom: true, count: 1 },
                { name: "The Lounge", thisRoom: false, count: 2 },
            ],
        });
    });

    it("lists only other rooms when this room holds no copy, and has no cap", () => {
        const many = Array.from({ length: 40 }, (_, i) => ({
            wamUrl: `https://maps.example/universe/world/room-${i}/map.wam`,
            count: 1,
        }));
        const step = deleteStep(describePlacedIn(many, names, OFFICE));
        expect(step.ask && step.rooms).toHaveLength(40);
        expect(step.ask && step.rooms.every((room) => !room.thisRoom)).toBe(true);
    });

    it("falls back to the room's folder name when the world doesn't list it, and finds this room across hosts", () => {
        const step = describePlacedIn(
            [
                { wamUrl: ATTIC, count: 1 },
                { wamUrl: "http://map-storage:3000/universe/world/office/map.wam", count: 1 },
            ],
            names,
            OFFICE
        );
        expect(step.map((room) => room.name)).toEqual([undefined, "attic"]);
        expect(step[0].thisRoom).toBe(true);
    });
});
