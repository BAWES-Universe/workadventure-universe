import { beforeEach, describe, expect, it, vi } from "vitest";

const walkToPartner = vi.fn();
const goToPage = vi.fn();
vi.mock("../../Components/Room/DirectChat/PartnerActions", () => ({ walkToPartner }));
vi.mock("../../../Api/ScriptUtils", () => ({ scriptUtils: { goToPage } }));

const LINK = { url: "https://play.example/@/bawes/hq/lobby", room: "Lobby", world: "BAWES HQ" };
const onMap = { actions: { walkTo: true, locate: true } } as never;
const away = { actions: { walkTo: false, locate: false } } as never;

describe("visitBotRoom", () => {
    beforeEach(() => vi.clearAllMocks());

    it("walks to the bot while it is on a map, from anywhere", async () => {
        const { roomCardTarget, visitBotRoom } = await import("../visitBotRoom");
        expect(roomCardTarget(LINK, onMap, LINK.url)).toBe("bot");
        expect(roomCardTarget(LINK, onMap, "https://play.example/@/other/room/x")).toBe("bot");
        visitBotRoom(LINK, onMap, undefined);
        expect(walkToPartner).toHaveBeenCalledWith(onMap);
        expect(goToPage).not.toHaveBeenCalled();
    });

    it("goes into the bot's room when the bot isn't on a map", async () => {
        const { visitBotRoom } = await import("../visitBotRoom");
        visitBotRoom(LINK, away, "https://play.example/@/other/room/x");
        expect(goToPage).toHaveBeenCalledWith(LINK.url);
        expect(walkToPartner).not.toHaveBeenCalled();
    });

    it("does nothing when you are already in its room and it isn't there", async () => {
        const { roomCardTarget, visitBotRoom } = await import("../visitBotRoom");
        expect(roomCardTarget(LINK, undefined, LINK.url)).toBe("here");
        visitBotRoom(LINK, undefined, LINK.url);
        expect(goToPage).not.toHaveBeenCalled();
        expect(walkToPartner).not.toHaveBeenCalled();
    });
});
