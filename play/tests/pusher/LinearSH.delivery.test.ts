import { describe, it, expect, vi } from "vitest";
vi.mock("../../src/pusher/services/JWTTokenManager", () => ({ jwtTokenManager: { verifyJWTToken: vi.fn() } }));
import { authorizedLinearShFanout } from "../../src/pusher/services/LinearShGateway";

const socket = (id: string, logged = true) => {
    const data = {
        token: `token-${id}`,
        isLogged: logged,
        userUuid: id,
        spaceUserId: `space-${id}`,
        disconnecting: false,
        spaces: new Set(["bubble"]),
    };
    return { data, getUserData: () => data };
};
describe("Linear SH final delivery boundary", () => {
    it("releases only to the current sole employee and denies guest/nonmember recipients", async () => {
        const a = socket("a"),
            guest = socket("g", false),
            outsider = socket("outsider");
        const recipients = [a, guest, outsider];
        const live = new Map(recipients.map((s) => [s.data.spaceUserId, s]));
        const sent: string[] = [];
        const authorize = vi.fn(async (d) => {
            await Promise.resolve();
            const late = socket("late", false);
            live.set(late.data.spaceUserId, late);
            return { authorized: d.userUuid !== "outsider", subject: d.userUuid, text: "Fictional task" };
        });
        await authorizedLinearShFanout(
            recipients,
            "bubble",
            authorize,
            (s, id) => live.get(id) === s,
            (s) => sent.push(s.data.userUuid),
            () => true
        );
        expect(sent.sort()).toEqual(["a"]);
        expect(authorize).toHaveBeenCalledTimes(2);
    });
    it.each(["leave", "replace", "identity", "logout", "disconnect"])(
        "rechecks after authorization await: %s",
        async (change) => {
            const a = socket("a");
            let live = a;
            const sent = vi.fn();
            await authorizedLinearShFanout(
                [a],
                "bubble",
                async () => {
                    await Promise.resolve();
                    if (change === "leave") a.data.spaces.clear();
                    if (change === "replace") live = socket("a");
                    if (change === "identity") a.data.userUuid = "other";
                    if (change === "logout") a.data.isLogged = false;
                    if (change === "disconnect") a.data.disconnecting = true;
                    return { authorized: true, subject: "a", text: "Fictional task" };
                },
                (s) => s === live,
                sent,
                () => true
            );
            expect(sent).not.toHaveBeenCalled();
        }
    );
    it("fails closed when membership is unavailable; memory text has the same gate", async () => {
        const send = vi.fn();
        await authorizedLinearShFanout(
            [socket("a")],
            "bubble",
            async () => {
                await Promise.resolve();
                throw new Error("unavailable");
            },
            () => true,
            send,
            () => true
        );
        expect(send).not.toHaveBeenCalled();
    });
});
