import { beforeEach, describe, expect, it, vi } from "vitest";
import { BotApiService } from "./BotApiService";

vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: { getAuthToken: () => null, setAuthToken: vi.fn() },
}));
vi.mock("../../../Connection/AxiosUtils", () => ({ axiosToPusher: { get: vi.fn() } }));

const ORBIT = "https://orbit.test";
const ROOM = "https://play.test/@/bawes/hq/lobby";
const SESSION = `orb_sess_v2_${"d".repeat(64)}`;

function service(roomId: string | null = ROOM): BotApiService {
    const api = new BotApiService();
    api.initialize("header.e30.signature", ORBIT, roomId as string, "https://bots.test");
    // Orbit's own access token is read from the game token; give it one and skip the session exchange
    (api as unknown as { accessToken: string }).accessToken = "token";
    vi.spyOn(
        api as unknown as { getAdminApiSessionToken: () => Promise<string> },
        "getAdminApiSessionToken"
    ).mockResolvedValue(SESSION);
    return api;
}

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("asking Orbit what the membership button on a card says", () => {
    beforeEach(() => {
        sessionStorage.clear();
        vi.restoreAllMocks();
    });

    it("asks for this room and this person, signed in with the Orbit session", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValue(json({ button: { kind: "roles", label: "Roles" } }));
        await expect(service().getMembershipButton("ali@example.com")).resolves.toEqual({
            kind: "roles",
            label: "Roles",
        });
        expect(fetchMock).toHaveBeenCalledWith(
            `${ORBIT}/api/me/membership-button?roomId=${encodeURIComponent(ROOM)}&userUuid=${encodeURIComponent(
                "ali@example.com"
            )}`,
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${SESSION}` }) })
        );
    });

    it.each([
        ["Give membership", "membership"],
        ["Pending invite", "pending"],
        ["Membership", "membership"],
    ])("passes on %s", async (label, kind) => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ button: { kind, label } }));
        await expect(service().getMembershipButton("ali")).resolves.toEqual({ kind, label });
    });

    it.each([
        ["no button", json({ button: null })],
        ["a kind it does not know", json({ button: { kind: "delete", label: "Delete" } })],
        ["a button without a name", json({ button: { kind: "roles", label: "" } })],
        ["an answer that is not a button", json({ button: "yes" })],
        ["an error", json({ error: "nope" }, 500)],
        ["a refusal", json({ error: "Unauthorized" }, 401)],
    ])("is null for %s, so the card shows no button", async (_name, response) => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
        await expect(service().getMembershipButton("ali")).resolves.toBeNull();
    });

    it("is null when Orbit cannot be reached", async () => {
        vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
        await expect(service().getMembershipButton("ali")).resolves.toBeNull();
    });

    it("does not ask without Orbit, a sign-in or a room", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch");
        await expect(new BotApiService().getMembershipButton("ali")).resolves.toBeNull();
        const noRoom = service("");
        await expect(noRoom.getMembershipButton("ali")).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
