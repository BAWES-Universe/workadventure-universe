import { describe, expect, it, vi } from "vitest";
import { addMembershipCardButton, type MembershipCardButtonDeps } from "../MembershipCardButton";
import type { MembershipButton } from "../../../external-modules/bots/services/BotApiService";

const ICONS = { membership: "planet", pending: "clock", roles: "cog" } as unknown as MembershipCardButtonDeps["icons"];

function setup(answer: MembershipButton | null, stillShown = true) {
    const add = vi.fn();
    const open = vi.fn();
    const ask = vi.fn().mockResolvedValue(answer);
    const done = addMembershipCardButton({
        userUuid: "ali",
        ask,
        stillShown: () => stillShown,
        add,
        open,
        icons: ICONS,
    });
    return { add, open, ask, done };
}

describe("the membership button on a person's card", () => {
    it.each([
        ["membership", "Give membership", "planet"],
        ["membership", "Membership", "planet"],
        ["pending", "Pending invite", "clock"],
        ["roles", "Roles", "cog"],
    ] as const)("adds %s named “%s” once Orbit answers, with its own icon", async (kind, label, icon) => {
        const { add, ask, done } = setup({ kind, label });
        await expect(done).resolves.toBe(true);
        expect(ask).toHaveBeenCalledWith("ali");
        expect(add).toHaveBeenCalledTimes(1);
        expect(add.mock.calls[0][0]).toMatchObject({
            actionName: label,
            actionIcon: icon,
            testId: "wokamenu-membership-button",
            protected: false,
        });
    });

    it("opens Orbit on their membership when tapped", async () => {
        const { add, open, done } = setup({ kind: "roles", label: "Roles" });
        await done;
        add.mock.calls[0][0].callback();
        expect(open).toHaveBeenCalledWith("ali");
    });

    it("adds nothing when Orbit says there is no button, or did not answer", async () => {
        const { add, done } = setup(null);
        await expect(done).resolves.toBe(false);
        expect(add).not.toHaveBeenCalled();
    });

    it("adds nothing when the card closed or turned to someone else while Orbit was asked", async () => {
        const { add, done } = setup({ kind: "membership", label: "Give membership" }, false);
        await expect(done).resolves.toBe(false);
        expect(add).not.toHaveBeenCalled();
    });
});
