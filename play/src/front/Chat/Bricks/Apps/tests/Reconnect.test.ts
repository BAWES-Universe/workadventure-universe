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

    // jsdom takes only a real window as a message's source, so it is set on the event after it is made
    const handOver = (data: unknown, origin = window.location.origin, from: unknown = popup) => {
        const event = new MessageEvent("message", { data, origin });
        Object.defineProperty(event, "source", { value: from });
        window.dispatchEvent(event);
    };

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

    it("is still done when picking where it works fails or is cancelled after it signed in", async () => {
        game.finishGitHubSignIn.mockResolvedValue({
            installUrl: "https://github.com/apps/bawes-universe/installations/new?state=I",
        });
        const result = signInInPopup("c1");
        await vi.waitFor(() => expect(popup.location.href).toContain("github.com/login"));
        handOver({ type: "oauth-github", state: "S", code: "C" });
        await vi.waitFor(() => expect(popup.location.href).toContain("installations/new"));
        handOver({ type: "oauth-failure" });
        expect(await result).toBe("done");
    });

    it("is stopped when the sign-in fails before it finished", async () => {
        const result = signInInPopup("c1");
        await vi.waitFor(() => expect(popup.location.href).toContain("github.com/login"));
        handOver({ type: "oauth-failure" });
        expect(await result).toBe("stopped");
        expect(game.finishGitHubSignIn).not.toHaveBeenCalled();
    });

    it("opens a window of its own for each attempt, and takes only its own window's word", async () => {
        const other = { location: { href: "" }, close: vi.fn(), closed: false };
        vi.mocked(window.open)
            .mockReturnValueOnce(popup as unknown as Window)
            .mockReturnValueOnce(other as unknown as Window);
        const first = signInInPopup("c1");
        const second = signInInPopup("c2");
        await vi.waitFor(() => expect(other.location.href).toContain("github.com"));
        const names = vi.mocked(window.open).mock.calls.map((call) => call[1]);
        expect(new Set(names).size).toBe(2);
        let settled = false;
        void first.then(() => (settled = true));
        // The second window's result settles only the second attempt
        handOver({ type: "oauth-success" }, window.location.origin, other);
        expect(await second).toBe("done");
        await Promise.resolve();
        expect(settled).toBe(false);
        // Nor does some other window's word settle the first
        handOver({ type: "oauth-success" }, window.location.origin, { another: "window" });
        await Promise.resolve();
        expect(settled).toBe(false);
        handOver({ type: "oauth-success" });
        expect(await first).toBe("done");
    });
});
