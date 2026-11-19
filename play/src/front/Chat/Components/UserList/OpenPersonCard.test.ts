import { beforeEach, describe, expect, it, vi } from "vitest";

const openWokaMenu = vi.fn();
const tappedPerson = vi.fn();
const locatePerson = vi.fn();
const nearestSessionOnThisMap = vi.fn(<T>(sessions: T[], fallback: T) => sessions[0] ?? fallback);

vi.mock("../../../Administration/AnalyticsClient", () => ({ analyticsClient: { openWokaMenu } }));
vi.mock("../../Stores/PeopleCardReturnStore", () => ({ peopleCardReturn: { tappedPerson } }));
vi.mock("./PersonNavigation", () => ({ locatePerson, nearestSessionOnThisMap }));

describe("openPersonCard", () => {
    beforeEach(() => {
        openWokaMenu.mockClear();
        tappedPerson.mockClear();
        locatePerson.mockClear();
        nearestSessionOnThisMap.mockClear();
    });

    it("shows a person on the map and opens their card: the same steps for Everyone rows and friends who are here", async () => {
        const { openPersonCard } = await import("./OpenPersonCard");
        const mishari = { uuid: "uuid-mishari", playUri: "https://play.test/@/bawes/hub/lobby", spaceUserId: "r_7" };
        openPersonCard(mishari, [mishari], "Mishari");
        expect(openWokaMenu).toHaveBeenCalledTimes(1);
        expect(tappedPerson).toHaveBeenCalledWith("uuid-mishari");
        expect(locatePerson).toHaveBeenCalledWith(mishari, "Mishari");
    });

    it("points at the session of theirs closest to you when they have several", async () => {
        const { openPersonCard } = await import("./OpenPersonCard");
        const far = { uuid: "u", playUri: "https://play.test/@/a/b/c", spaceUserId: "r_1" };
        const near = { uuid: "u", playUri: "https://play.test/@/a/b/c", spaceUserId: "r_2" };
        nearestSessionOnThisMap.mockReturnValueOnce(near);
        openPersonCard(far, [far, near], "Yousef");
        expect(locatePerson).toHaveBeenCalledWith(near, "Yousef");
    });

    it("does nothing for someone with no map to show", async () => {
        const { openPersonCard } = await import("./OpenPersonCard");
        openPersonCard({ uuid: "u", playUri: "" }, [], "Sara");
        openPersonCard({ playUri: "https://play.test/@/a/b/c" }, [], "Guest");
        expect(locatePerson).not.toHaveBeenCalled();
        expect(tappedPerson).not.toHaveBeenCalled();
        expect(openWokaMenu).not.toHaveBeenCalled();
    });
});
