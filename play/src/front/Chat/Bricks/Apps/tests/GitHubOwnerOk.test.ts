import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    (window as unknown as { env: Record<string, unknown> }).env = {};
});

import { askOwnerInPopup } from "../GitHubOwnerOk";

/** "Ask the owner" for an organization that has not allowed Universe (design 14 Nov, Part 3). */
describe("asking an organization's owner from a Brick's card", () => {
    let popup: { location: { href: string }; close: ReturnType<typeof vi.fn>; closed: boolean };
    const steps = {
        askUrl: vi.fn<(org: string, returnTo: string) => Promise<string>>(),
        finishSignIn: vi.fn<(state: string, code: string) => Promise<unknown>>(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        popup = { location: { href: "" }, close: vi.fn(), closed: false };
        vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
        steps.askUrl.mockResolvedValue(
            "https://github.com/apps/bawes-universe/installations/new/permissions?target_id=4242&state=T"
        );
        steps.finishSignIn.mockResolvedValue({ installUrl: null });
    });

    const send = (data: unknown, origin = window.location.origin) =>
        window.dispatchEvent(new MessageEvent("message", { data, origin }));

    it("opens the window first, in the tap, then puts GitHub's page for that organization in it", async () => {
        const result = askOwnerInPopup("acme-corp", steps);
        // The window is open before Orbit answered
        expect(window.open).toHaveBeenCalledTimes(1);
        expect(popup.location.href).toBe("");
        await vi.waitFor(() => expect(popup.location.href).toContain("installations/new/permissions?target_id=4242"));
        expect(steps.askUrl).toHaveBeenCalledWith("acme-corp", window.location.href.split("?")[0].split("#")[0]);
        send({ type: "oauth-success" });
        expect(await result).toBe("asked");
        expect(steps.finishSignIn).not.toHaveBeenCalled();
    });

    it("finishes the sign-in GitHub did when an owner installed it, and is done", async () => {
        const result = askOwnerInPopup("acme-corp", steps);
        await vi.waitFor(() => expect(popup.location.href).toContain("github.com"));
        // Nothing from another site is taken
        send({ type: "oauth-github", state: "S", code: "C" }, "https://elsewhere.example");
        expect(steps.finishSignIn).not.toHaveBeenCalled();
        send({ type: "oauth-github", state: "S", code: "C" });
        expect(await result).toBe("installed");
        expect(steps.finishSignIn).toHaveBeenCalledWith("S", "C");
        expect(popup.close).toHaveBeenCalled();
    });

    it("is still installed when the sign-in could not be finished (the app is on the organization all the same)", async () => {
        steps.finishSignIn.mockRejectedValue(new Error("Not found"));
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const result = askOwnerInPopup("acme-corp", steps);
        await vi.waitFor(() => expect(popup.location.href).toContain("github.com"));
        send({ type: "oauth-github", state: "S", code: "C" });
        expect(await result).toBe("installed");
    });

    it("is blocked when the window cannot open, or Orbit has no page for the organization", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.mocked(window.open).mockReturnValueOnce(null);
        expect(await askOwnerInPopup("acme-corp", steps)).toBe("blocked");
        expect(steps.askUrl).not.toHaveBeenCalled();
        steps.askUrl.mockRejectedValueOnce(new Error("Not found"));
        expect(await askOwnerInPopup("acme-corp", steps)).toBe("blocked");
        expect(popup.close).toHaveBeenCalled();
    });

    it("stops when the window is closed by hand or GitHub did not take them back", async () => {
        const result = askOwnerInPopup("acme-corp", steps);
        await vi.waitFor(() => expect(popup.location.href).toContain("github.com"));
        send({ type: "oauth-failure" });
        expect(await result).toBe("stopped");

        steps.askUrl.mockResolvedValue("https://github.com/apps/x");
        popup.closed = true;
        expect(await askOwnerInPopup("acme-corp", steps)).toBe("stopped");
    });
});
