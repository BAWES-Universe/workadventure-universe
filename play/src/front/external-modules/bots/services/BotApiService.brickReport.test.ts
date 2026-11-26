import { afterEach, describe, expect, it, vi } from "vitest";
import { BotApiService } from "./BotApiService";

vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: { getAuthToken: () => null, setAuthToken: vi.fn() },
}));
vi.mock("../../../Connection/AxiosUtils", () => ({ axiosToPusher: { get: vi.fn() } }));

const ORBIT = "https://orbit.test";
const GUEST = "header.e30.signature";

const answer = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Take it back (mock "Brick reports inbox"): the key in the chat's message is the proof, so a guest can take a note back too. */
describe("taking back a note sent to the Universe team", () => {
    afterEach(() => vi.restoreAllMocks());

    it("asks Orbit with the key alone, with no sign-in, so a guest can", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(answer({ takenBack: true }));
        const api = new BotApiService();
        api.initialize(GUEST, ORBIT, "room-1", "https://bots.test");
        expect(await api.takeBackBrickReport("note-1", "key-1234567890abcdef")).toBe("taken");
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${ORBIT}/api/me/brick-reports/take-back`);
        expect(init?.method).toBe("POST");
        expect(init?.credentials).toBe("omit");
        expect(new Headers(init?.headers).has("Authorization")).toBe(false);
        expect(JSON.parse(init?.body as string)).toEqual({ id: "note-1", key: "key-1234567890abcdef" });
    });

    it("says too late past 24 hours, and failed when Orbit says no or can't be asked", async () => {
        const api = new BotApiService();
        api.initialize(GUEST, ORBIT, "room-1", "https://bots.test");
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(answer({ takenBack: false, reason: "too_late" }));
        expect(await api.takeBackBrickReport("note-1", "key-1234567890abcdef")).toBe("too_late");
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(answer({ error: "Origin not allowed" }, 403));
        expect(await api.takeBackBrickReport("note-1", "key-1234567890abcdef")).toBe("failed");
        vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("offline"));
        expect(await api.takeBackBrickReport("note-1", "key-1234567890abcdef")).toBe("failed");
        const nowhere = new BotApiService();
        expect(await nowhere.takeBackBrickReport("note-1", "key-1234567890abcdef")).toBe("failed");
    });
});

/** The person's own words and what became of a note: like Take it back, the key alone, no sign-in. */
describe("the person's words and what became of a note", () => {
    afterEach(() => vi.restoreAllMocks());

    it("sends the words with the key alone and reads back what Orbit kept", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValue(answer({ added: true, words: "Links do nothing" }));
        const api = new BotApiService();
        api.initialize(GUEST, ORBIT, "room-1", "https://bots.test");
        expect(await api.addBrickReportWords("note-1", "key-1234567890abcdef", "Links do nothing")).toEqual({
            outcome: "sent",
            words: "Links do nothing",
        });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${ORBIT}/api/me/brick-reports/words`);
        expect(init?.credentials).toBe("omit");
        expect(new Headers(init?.headers).has("Authorization")).toBe(false);
        expect(JSON.parse(init?.body as string)).toEqual({
            id: "note-1",
            key: "key-1234567890abcdef",
            words: "Links do nothing",
        });
        fetchMock.mockResolvedValueOnce(answer({ added: false, reason: "taken_back" }));
        expect(await api.addBrickReportWords("note-1", "key-1234567890abcdef", "x")).toEqual({ outcome: "taken_back" });
        fetchMock.mockRejectedValueOnce(new Error("offline"));
        expect(await api.addBrickReportWords("note-1", "key-1234567890abcdef", "x")).toEqual({ outcome: "failed" });
    });

    it("reads what became of a note, and says nothing when Orbit can't", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValue(answer({ state: "taken_back", words: "", canTakeBack: false }));
        const api = new BotApiService();
        api.initialize(GUEST, ORBIT, "room-1", "https://bots.test");
        expect(await api.brickReportStatus("note-1", "key-1234567890abcdef")).toEqual({
            state: "taken_back",
            words: "",
        });
        expect(fetchMock.mock.calls[0][0]).toBe(`${ORBIT}/api/me/brick-reports/status`);
        expect(fetchMock.mock.calls[0][1]?.credentials).toBe("omit");
        fetchMock.mockResolvedValueOnce(answer({ error: "Internal server error" }, 500));
        expect(await api.brickReportStatus("note-1", "key-1234567890abcdef")).toBeNull();
        expect(await new BotApiService().brickReportStatus("note-1", "key-1234567890abcdef")).toBeNull();
    });
});
