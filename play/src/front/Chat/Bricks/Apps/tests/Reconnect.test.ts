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
        window.dispatchEvent(new MessageEvent("message", { data, origin, source: popup as unknown as Window }));

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

    it("gives each sign-in a window of its own, so two overlapping sign-ins never share one", async () => {
        const open = vi.spyOn(window, "open");
        const second = { location: { href: "" }, close: vi.fn(), closed: false };
        open.mockReturnValueOnce(popup as unknown as Window).mockReturnValueOnce(second as unknown as Window);
        const first = signInInPopup("c1");
        const other = signInInPopup("c2");
        await vi.waitFor(() => expect(popup.location.href).toContain("github.com"));
        const names = open.mock.calls.map((call) => call[1]);
        expect(names).toHaveLength(2);
        expect(names[0]).toMatch(/^oauth-popup-./);
        expect(names[1]).toMatch(/^oauth-popup-./);
        expect(names[0]).not.toBe(names[1]);
        Object.assign(popup, { closed: true });
        Object.assign(second, { closed: true });
        window.dispatchEvent(new Event("focus"));
        await Promise.all([first, other]);
    });

    it("ignores a return from any window but its own, so another sign-in's return is never taken as its own", async () => {
        game.finishGitHubSignIn.mockResolvedValue({ installUrl: null });
        let settled: string | null = null;
        const result = signInInPopup("c1").then((value) => (settled = value));
        await vi.waitFor(() => expect(popup.location.href).toContain("github.com"));
        const foreign = { postMessage: vi.fn() } as unknown as Window;
        const fromForeign = (data: unknown) =>
            window.dispatchEvent(
                new MessageEvent("message", { data, origin: window.location.origin, source: foreign })
            );
        // Another sign-in's success, failure and GitHub hand-over: none of them is this one's
        fromForeign({ type: "oauth-success" });
        fromForeign({ type: "oauth-failure" });
        fromForeign({ type: "oauth-github", state: "S", code: "C" });
        window.dispatchEvent(
            new MessageEvent("message", { data: { type: "oauth-success" }, origin: window.location.origin })
        );
        await Promise.resolve();
        expect(settled).toBeNull();
        expect(game.finishGitHubSignIn).not.toHaveBeenCalled();
        handOver({ type: "oauth-success" });
        expect(await result).toBe("done");
    });

    it("makes the connection only once its window is open, and never when the browser blocks it", async () => {
        const toMake = vi.fn().mockResolvedValue("c1");
        vi.spyOn(window, "open").mockReturnValueOnce(null);
        expect(await signInInPopup(toMake)).toBe("blocked");
        expect(toMake).not.toHaveBeenCalled();
        vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
        const result = signInInPopup(toMake);
        await vi.waitFor(() => expect(popup.location.href).toContain("github.com"));
        expect(toMake).toHaveBeenCalledTimes(1);
        expect(game.startAppSignIn.mock.calls[0][0]).toBe("c1");
        handOver({ type: "oauth-success" });
        expect(await result).toBe("done");
    });

    it("closes the window and starts no sign-in for an app that is connected as it is", async () => {
        const alreadyConnected = vi.fn().mockResolvedValue(true);
        expect(await signInInPopup("c1", { alreadyConnected })).toBe("done");
        expect(alreadyConnected).toHaveBeenCalledWith("c1");
        expect(game.startAppSignIn).not.toHaveBeenCalled();
        expect(popup.close).toHaveBeenCalled();
        // A check that cannot be answered goes on to the sign-in
        alreadyConnected.mockRejectedValue(new Error("down"));
        const result = signInInPopup("c1", { alreadyConnected });
        await vi.waitFor(() => expect(game.startAppSignIn).toHaveBeenCalledTimes(1));
        Object.assign(popup, { closed: true });
        window.dispatchEvent(new Event("focus"));
        expect(await result).toBe("stopped");
    });

    it("is stopped from outside while the connection, the check or the sign-in request is still out: the window closes at once and nothing goes on", async () => {
        // The app's connection is still being made
        const connecting = new AbortController();
        const making = new Promise<string>(() => {
            // never answers
        });
        const first = signInInPopup(() => making, { signal: connecting.signal });
        connecting.abort();
        expect(await first).toBe("stopped");
        expect(popup.close).toHaveBeenCalled();
        expect(game.startAppSignIn).not.toHaveBeenCalled();

        // The "already connected" question is still out; a late "true" is no "done" for a sign-in that was stopped
        popup.close.mockClear();
        const asking = new AbortController();
        let answer: (value: boolean) => void = () => undefined;
        const alreadyConnected = vi.fn(
            () =>
                new Promise<boolean>((resolve) => {
                    answer = resolve;
                })
        );
        const second = signInInPopup("c1", { signal: asking.signal, alreadyConnected });
        await vi.waitFor(() => expect(alreadyConnected).toHaveBeenCalled());
        asking.abort();
        expect(await second).toBe("stopped");
        expect(popup.close).toHaveBeenCalled();
        answer(true);
        await Promise.resolve();
        expect(game.startAppSignIn).not.toHaveBeenCalled();

        // The sign-in request is still out
        popup.close.mockClear();
        const starting = new AbortController();
        let address: (value: string) => void = () => undefined;
        game.startAppSignIn.mockImplementationOnce(
            () =>
                new Promise<string>((resolve) => {
                    address = resolve;
                })
        );
        const third = signInInPopup("c1", { signal: starting.signal });
        await vi.waitFor(() => expect(game.startAppSignIn).toHaveBeenCalledTimes(1));
        starting.abort();
        expect(await third).toBe("stopped");
        expect(popup.close).toHaveBeenCalled();
        address("https://github.com/login/oauth/authorize?late=1");
        await Promise.resolve();
        expect(popup.location.href).toBe("");
    });

    it("is stopped from outside: the window closes and nothing stays listening", async () => {
        const controller = new AbortController();
        const removed = vi.spyOn(window, "removeEventListener");
        const result = signInInPopup("c1", { signal: controller.signal });
        await vi.waitFor(() => expect(popup.location.href).toContain("github.com"));
        controller.abort();
        expect(await result).toBe("stopped");
        expect(popup.close).toHaveBeenCalled();
        expect(removed).toHaveBeenCalledWith("message", expect.any(Function));
        expect(removed).toHaveBeenCalledWith("focus", expect.any(Function));
        // A return that comes afterwards changes nothing
        handOver({ type: "oauth-success" });
        // Already aborted before the window was ready: it never goes to the sign-in page
        game.startAppSignIn.mockClear();
        const early = new AbortController();
        early.abort();
        expect(await signInInPopup("c1", { signal: early.signal })).toBe("stopped");
        expect(popup.location.href).not.toBe("");
    });
});
