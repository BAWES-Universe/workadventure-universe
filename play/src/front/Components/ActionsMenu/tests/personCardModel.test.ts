import { describe, expect, it } from "vitest";
import type { WokaMenuAction } from "../../../Stores/WokaMenuStore";
import type { SpaceUserExtended } from "../../../Space/SpaceInterface";
import { findWorldUser, gridColumns, gridRows, splitCardActions, toCardAction, toneOf } from "../personCardModel";

const action = (name: string, extra: Partial<WokaMenuAction> = {}): WokaMenuAction => ({
    actionName: name,
    callback: () => undefined,
    ...extra,
});

describe("person card: how the buttons split into rows", () => {
    it("puts up to four buttons in one row", () => {
        expect([1, 2, 3, 4].map(gridColumns)).toEqual([1, 2, 3, 4]);
        expect([1, 2, 3, 4].map((count) => gridRows(count))).toEqual([[1], [2], [3], [4]]);
    });

    it("splits five 3 + 2 and six 3 + 3, never leaving one button alone", () => {
        expect(gridRows(5)).toEqual([3, 2]);
        expect(gridRows(6)).toEqual([3, 3]);
    });

    it("goes four to a row beyond six, or three when four would leave one alone", () => {
        expect(gridRows(7)).toEqual([4, 3]);
        expect(gridRows(8)).toEqual([4, 4]);
        expect(gridRows(9)).toEqual([3, 3, 3]);
    });

    it("has no rows without buttons", () => {
        expect(gridRows(0)).toEqual([]);
        expect(gridColumns(0)).toBe(1);
    });

    it("never ends on a lone button, for any count from two up", () => {
        for (let count = 2; count <= 12; count++) {
            expect(gridRows(count).at(-1)).toBeGreaterThan(1);
        }
    });
});

describe("person card: which actions are tiles and which wait under More", () => {
    const walk = action("Walk to", { priority: 2 });
    const message = action("Message", { priority: 1 });
    const block = action("Block or report", { priority: -1, overflow: true, style: "text-red-500" });

    it("orders the tiles by priority and keeps the overflow for More", () => {
        const { main, more } = splitCardActions([block, message, walk], false);
        expect(main.map((a) => a.actionName)).toEqual(["Walk to", "Message"]);
        expect(more.map((a) => a.actionName)).toEqual(["Block or report"]);
    });

    it("gives a bot's card no More at all", () => {
        const { main, more } = splitCardActions([block, message, walk], true);
        expect(main.map((a) => a.actionName)).toEqual(["Walk to", "Message"]);
        expect(more).toEqual([]);
    });

    it("tells the main step and the harsh ones by their style", () => {
        expect(toneOf("is-primary")).toBe("go");
        expect(toneOf("text-red-500")).toBe("danger");
        expect(toneOf("bg-white/10 hover:bg-white/30")).toBeUndefined();
        expect(toCardAction(block).tone).toBe("danger");
    });

    it("keeps an action's own image icon apart from a component icon", () => {
        expect(toCardAction(action("Block", { actionIcon: "/ban.svg" })).iconSrc).toBe("/ban.svg");
        expect(toCardAction(action("Block", { actionIcon: "/ban.svg" })).icon).toBeUndefined();
    });
});

describe("person card: which session of the person the card is about", () => {
    const session = (uuid: string, userId: number) =>
        ({ uuid, spaceUserId: `https://play/_/room_${userId}` } as unknown as SpaceUserExtended);
    const users = new Map([
        ["a", session("sara", 3)],
        ["b", session("sara", 7)],
        ["c", session("omar", 8)],
    ]);

    it("takes the session whose avatar the card shows", () => {
        expect(findWorldUser(users, "sara", 7)).toBe(users.get("b"));
        expect(findWorldUser(users, "sara", 3)).toBe(users.get("a"));
    });

    it("takes any session of the account when the avatar isn't known yet", () => {
        expect(findWorldUser(users, "sara", -1)).toBe(users.get("a"));
        expect(findWorldUser(users, "omar", 99)).toBe(users.get("c"));
    });

    it("finds nobody for an unknown account, or before the world is known", () => {
        expect(findWorldUser(users, "ghost", 1)).toBeUndefined();
        expect(findWorldUser(undefined, "sara", 7)).toBeUndefined();
        expect(findWorldUser(users, "", 7)).toBeUndefined();
    });
});
