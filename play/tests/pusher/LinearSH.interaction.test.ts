import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/pusher/services/JWTTokenManager", () => ({ jwtTokenManager: { verifyJWTToken: vi.fn() } }));
import { LinearShInteraction } from "../../src/pusher/services/LinearShInteraction";
import { authorizedLinearShFanout } from "../../src/pusher/services/LinearShGateway";

const socket = (subject: string, logged = true) => {
    const data = {
        token: `fixture-${subject}`,
        userUuid: subject,
        spaceUserId: subject,
        isLogged: logged,
        disconnecting: false,
        spaces: new Set(["bubble"]),
    };
    return { getUserData: () => data };
};
function fixture() {
    vi.stubEnv("LINEAR_SH_BOT_ID", "enrolled");
    const a = socket("employee-a"),
        bot = socket("bot-enrolled");
    const sockets = new Map([a, bot].map((s) => [s.getUserData().spaceUserId, s]));
    const members = new Set(sockets.keys());
    const interaction = new LinearShInteraction(
        "bubble",
        () => members,
        () => sockets
    );
    return { a, bot, sockets, members, interaction };
}
afterEach(() => vi.unstubAllEnvs());
describe("Linear SH server interaction", () => {
    it.each([false, true])(
        "a second human (logged=%s), including rapid join/leave, invalidates the generation and receipt",
        async (logged) => {
            const f = fixture();
            const id = f.interaction.capture(f.a)!;
            f.interaction.displayed(id, "request");
            expect(await f.interaction.check(id, "request")).toBe(true);
            const other = socket("other", logged);
            f.interaction.invalidate(); // production register/add hook, before any awaited admission
            f.sockets.set("other", other);
            f.members.add("other");
            expect(f.interaction.capture(f.a)).toBeUndefined();
            f.sockets.delete("other");
            f.members.delete("other");
            f.interaction.invalidate();
            expect(await f.interaction.check(id)).toBe(false);
            expect(f.interaction.capture(f.a)).not.toBe(id);
        }
    );
    it.each(["leave", "replace", "token", "account", "disconnect"])(
        "ends the interaction on %s, even for the same returning account",
        (change) => {
            const f = fixture();
            const id = f.interaction.capture(f.a)!;
            if (change === "leave") {
                f.interaction.invalidate();
                f.a.getUserData().spaces.clear();
            }
            if (change === "replace") f.sockets.set("employee-a", socket("employee-a"));
            if (change === "token") f.a.getUserData().token = "new-fixture-token";
            if (change === "account") f.a.getUserData().userUuid = "employee-b";
            if (change === "disconnect") f.a.getUserData().disconnecting = true;
            expect(f.interaction.current(id)).toBe(false);
        }
    );
    it("denies a guest, unknown remote member, duplicate bot identity and remote bot without trusting display fields", () => {
        const f = fixture();
        f.a.getUserData().isLogged = false;
        expect(f.interaction.capture(f.a)).toBeUndefined();
        f.a.getUserData().isLogged = true;
        f.members.add("unknown-remote");
        expect(f.interaction.capture(f.a)).toBeUndefined();
        f.members.delete("unknown-remote");
        f.a.getUserData().userUuid = "bot-enrolled";
        expect(f.interaction.capture(f.a)).toBeUndefined();
        f.a.getUserData().userUuid = "employee-a";
        f.sockets.delete("bot-enrolled");
        expect(f.interaction.capture(f.a)).toBeUndefined();
    });
    it("drops a late response/preview after a join then leave during recipient authorization", async () => {
        const f = fixture();
        const id = f.interaction.capture(f.a)!;
        const emit = vi.fn();
        await authorizedLinearShFanout(
            [f.a],
            "bubble",
            async () => {
                f.interaction.invalidate();
                f.members.add("guest");
                await Promise.resolve();
                f.members.delete("guest");
                f.interaction.invalidate();
                return { authorized: true, subject: "employee-a", text: "Fictional private task" };
            },
            () => true,
            emit,
            () => f.interaction.current(id)
        );
        expect(emit).not.toHaveBeenCalled();
    });
    it("a new visitor and returning A get fresh generations; notices do not repeat", () => {
        const f = fixture();
        const a = f.interaction.capture(f.a)!;
        f.interaction.invalidate();
        f.sockets.delete("employee-a");
        f.members.delete("employee-a");
        const b = socket("employee-b");
        f.sockets.set("employee-b", b);
        f.members.add("employee-b");
        const bid = f.interaction.capture(b)!;
        expect(bid).not.toBe(a);
        const emit = vi.fn();
        f.interaction.notice(b, "Please use Linear SH one person at a time.", emit);
        f.interaction.notice(b, "Please use Linear SH one person at a time.", emit);
        expect(emit).toHaveBeenCalledTimes(1);
        f.interaction.invalidate();
        f.sockets.delete("employee-b");
        f.members.delete("employee-b");
        f.sockets.set("employee-a", f.a);
        f.members.add("employee-a");
        expect(f.interaction.capture(f.a)).not.toBe(a);
        expect(f.interaction.current(bid)).toBe(false);
    });
});
