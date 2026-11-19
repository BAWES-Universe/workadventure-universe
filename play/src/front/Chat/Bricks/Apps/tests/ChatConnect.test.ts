import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppOffer } from "../../Brick";
import { connectFromCard, type ChatConnectSteps } from "../ChatConnect";

const offer = (over: Partial<AppOffer> = {}): AppOffer => ({
    topic: "app notion",
    app: "notion",
    name: "Notion",
    connectKind: "listed",
    state: "new",
    connectionId: null,
    ask: "",
    asked: true,
    other: null,
    ...over,
});

describe("Connect from a Brick's card in a chat (#2001)", () => {
    let steps: ChatConnectSteps;
    /** What the sign-in window does with the connection it is handed: open, ask for it, and end. */
    let signIn: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        signIn = vi.fn(async (makeApp: () => Promise<string>) => {
            await makeApp();
            return "done";
        });
        steps = {
            connectListedApp: vi.fn().mockResolvedValue("c1"),
            signIn: signIn as unknown as ChatConnectSteps["signIn"],
            connectReadyMade: vi.fn().mockResolvedValue({ status: "connected", appId: "rm1" }),
            isConnected: vi.fn().mockResolvedValue(false),
            letBrickUse: vi.fn().mockResolvedValue(undefined),
            carryOn: vi.fn().mockResolvedValue(undefined),
            refresh: vi.fn().mockResolvedValue(undefined),
        };
    });

    it("connects, lets the Brick use it and tells it to carry on", async () => {
        expect(await connectFromCard(offer(), "b1", steps)).toBe("connected");
        expect(steps.letBrickUse).toHaveBeenCalledWith("c1", "b1");
        expect(steps.carryOn).toHaveBeenCalledWith({ app: "notion", name: "Notion" });
    });

    it("says so, and only that, when the Brick was let use it but could not be told to carry on", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.mocked(steps.carryOn).mockRejectedValue(new Error("not now"));
        expect(await connectFromCard(offer(), "b1", steps)).toBe("not_resumed");
        // The grant stood: it is not reported as a failed grant
        expect(steps.letBrickUse).toHaveBeenCalledTimes(1);
    });

    it("says not_let when the grant fails, and makes no connection when the window could not open", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.mocked(steps.letBrickUse).mockRejectedValue(new Error("no"));
        expect(await connectFromCard(offer(), "b1", steps)).toBe("not_let");
        // A window the browser blocked never asks for the connection
        vi.mocked(steps.connectListedApp).mockClear();
        signIn.mockResolvedValue("blocked");
        expect(await connectFromCard(offer(), "b1", steps)).toBe("blocked");
        expect(steps.connectListedApp).not.toHaveBeenCalled();
    });

    it("connects a ready-made App through its own sign-in, and never through the listed one", async () => {
        expect(await connectFromCard(offer({ connectKind: "readyMade" }), "b1", steps)).toBe("connected");
        expect(steps.connectReadyMade).toHaveBeenCalledWith({ key: "notion", name: "Notion" });
        expect(steps.connectListedApp).not.toHaveBeenCalled();
        expect(signIn).not.toHaveBeenCalled();
        expect(steps.letBrickUse).toHaveBeenCalledWith("rm1", "b1");
        // A sign-in that did not finish leaves nothing to undo; a blocked window makes no connection
        vi.mocked(steps.connectReadyMade).mockResolvedValue({ status: "stopped" });
        expect(await connectFromCard(offer({ connectKind: "readyMade" }), "b1", steps)).toBe("stopped");
        vi.mocked(steps.connectReadyMade).mockResolvedValue({ status: "blocked" });
        expect(await connectFromCard(offer({ connectKind: "readyMade" }), "b1", steps)).toBe("blocked");
        expect(steps.letBrickUse).toHaveBeenCalledTimes(1);
    });

    it("hands the window a way to tell an App that needs no sign-in, so it closes without starting one", async () => {
        vi.mocked(steps.isConnected).mockResolvedValue(true);
        signIn.mockImplementation(
            async (makeApp: () => Promise<string>, alreadyConnected: (id: string) => Promise<boolean>) => {
                const id = await makeApp();
                // The window's own rule: connected as it is, so no sign-in
                return (await alreadyConnected(id)) ? "done" : "stopped";
            }
        );
        expect(await connectFromCard(offer(), "b1", steps)).toBe("connected");
        expect(steps.isConnected).toHaveBeenCalledWith("c1");
    });

    it("lets a Brick use an App they connected already without a second sign-in", async () => {
        expect(await connectFromCard(offer({ state: "connected", connectionId: "c7" }), "b1", steps)).toBe("connected");
        expect(signIn).not.toHaveBeenCalled();
        expect(steps.letBrickUse).toHaveBeenCalledWith("c7", "b1");
    });

    it("says stopped when the window was closed, and blocked when the connection could not be made", async () => {
        signIn.mockImplementation(async (makeApp: () => Promise<string>) => {
            await makeApp().catch(() => undefined);
            return "stopped";
        });
        expect(await connectFromCard(offer(), "b1", steps)).toBe("stopped");
        vi.mocked(steps.connectListedApp).mockRejectedValue(new Error("no"));
        signIn.mockImplementation(async (makeApp: () => Promise<string>) => {
            await makeApp().catch(() => undefined);
            return "blocked";
        });
        expect(await connectFromCard(offer(), "b1", steps)).toBe("blocked");
    });
});
