import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    (window as unknown as { env: Record<string, unknown> }).env = {};
});

const game = vi.hoisted(() => ({
    startAppSignIn: vi.fn<(id: string, redirectUrl: string, callbackUrl: string) => Promise<string>>(),
    finishGitHubSignIn: vi.fn<(state: string, code: string) => Promise<{ installUrl: string | null }>>(),
}));
vi.mock("../../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: { startAppSignIn: game.startAppSignIn, finishGitHubSignIn: game.finishGitHubSignIn },
}));

import { signInInPopup } from "../Reconnect";

/** GitHub's sign-in (#2041) is finished by the window that started it, with the person's own sign-in. */
describe("finishing a GitHub sign-in from the window that started it", () => {
    let popup: { location: { href: string }; close: ReturnType<typeof vi.fn>; closed: boolean };

    beforeEach(() => {
        vi.clearAllMocks();
        popup = { location: { href: "" }, close: vi.fn(), closed: false };
        vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
        game.startAppSignIn.mockResolvedValue("https://github.com/login/oauth/authorize?x=1");
    });

    const handOver = (data: unknown, origin = window.location.origin) =>
        window.dispatchEvent(new MessageEvent("message", { data, origin }));

    it("finishes it with the code the return page hands over, then closes the window", async () => {
        game.finishGitHubSignIn.mockResolvedValue({ installUrl: null });
        const result = signInInPopup("c1");
        await vi.waitFor(() => expect(popup.location.href).toContain("github.com"));
        handOver({ type: "oauth-github", state: "S", code: "C" });
        expect(await result).toBe("done");
        expect(game.finishGitHubSignIn).toHaveBeenCalledWith("S", "C");
        expect(popup.close).toHaveBeenCalled();
    });

    it("sends the same window on to pick where it works, and is done when that page says so", async () => {
        game.finishGitHubSignIn.mockResolvedValue({
            installUrl: "https://github.com/apps/bawes-universe/installations/new?state=I",
        });
        let settled = false;
        const result = signInInPopup("c1").then((value) => {
            settled = true;
            return value;
        });
        await vi.waitFor(() => expect(popup.location.href).toContain("github.com/login"));
        handOver({ type: "oauth-github", state: "S", code: "C" });
        await vi.waitFor(() =>
            expect(popup.location.href).toBe("https://github.com/apps/bawes-universe/installations/new?state=I")
        );
        expect(settled).toBe(false);
        expect(popup.close).not.toHaveBeenCalled();
        handOver({ type: "oauth-success" });
        expect(await result).toBe("done");
    });

    it("stops when the sign-in cannot be finished, and never takes a code from another site", async () => {
        game.finishGitHubSignIn.mockRejectedValue(new Error("Not found"));
        const result = signInInPopup("c1");
        await vi.waitFor(() => expect(popup.location.href).toContain("github.com"));
        handOver({ type: "oauth-github", state: "S", code: "C" }, "https://elsewhere.example");
        expect(game.finishGitHubSignIn).not.toHaveBeenCalled();
        handOver({ type: "oauth-github", state: "S", code: "C" });
        expect(await result).toBe("stopped");
        expect(popup.close).toHaveBeenCalled();
    });

    it("never calls a sign-in stopped while it is being finished, and is done when the window closes after it signed in", async () => {
        let answer: (value: { installUrl: string | null }) => void = () => undefined;
        game.finishGitHubSignIn.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        let settled: string | null = null;
        const result = signInInPopup("c1").then((value) => (settled = value));
        await vi.waitFor(() => expect(popup.location.href).toContain("github.com"));
        handOver({ type: "oauth-github", state: "S", code: "C" });
        popup.closed = true;
        window.dispatchEvent(new Event("focus"));
        await Promise.resolve();
        expect(settled).toBeNull();
        answer({ installUrl: "https://github.com/apps/bawes-universe/installations/new" });
        await vi.waitFor(() => expect(popup.location.href).toContain("installations/new"));
        // They close the install page without picking anywhere: still signed in
        window.dispatchEvent(new Event("focus"));
        expect(await result).toBe("done");
    });
});
