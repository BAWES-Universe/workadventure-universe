/**
 * AdminApiService.getBotQuests: asks Orbit for the quests a bot gives with the service token, once per bot for a
 * while, and answers null when Orbit is not there (workadventure-universe#565).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGet = vi.fn();
vi.mock("axios", () => ({
    default: {
        get: (...args: unknown[]) => mockGet(...args),
        isAxiosError: (error: unknown) => typeof error === "object" && error !== null && "response" in error,
    },
}));

import { AdminApiService } from "../server/AdminApiService";

const LIST = {
    botId: "b-1",
    roomId: "r-1",
    source: "welcome-chapter",
    quests: [{ id: "welcome.meet", title: "Meet someone", description: "Say hi.", objective: "Say hi to someone", minutes: 2, badge: "First Hello" }],
};

beforeEach(() => {
    mockGet.mockReset();
});

describe("AdminApiService.getBotQuests", () => {
    it("asks Orbit with the service token and reads the list", async () => {
        mockGet.mockResolvedValue({ data: LIST });
        const service = new AdminApiService("http://orbit.test/", "service-token");
        expect(await service.getBotQuests("b-1")).toEqual(LIST);
        expect(mockGet).toHaveBeenCalledWith(
            "http://orbit.test/api/bots/b-1/quests",
            expect.objectContaining({ headers: { Authorization: "Bearer service-token" } })
        );
    });

    it("asks once per bot until the cache is cleared", async () => {
        mockGet.mockResolvedValue({ data: LIST });
        const service = new AdminApiService("http://orbit.test", "service-token");
        await service.getBotQuests("b-1");
        await service.getBotQuests("b-1");
        expect(mockGet).toHaveBeenCalledTimes(1);
        await service.getBotQuests("b-2");
        expect(mockGet).toHaveBeenCalledTimes(2);
        service.clearBotQuestsCache("b-1");
        await service.getBotQuests("b-1");
        expect(mockGet).toHaveBeenCalledTimes(3);
    });

    it("answers null when Orbit is not configured, has no such bot, or fails", async () => {
        expect(await new AdminApiService("", "").getBotQuests("b-1")).toBeNull();
        expect(mockGet).not.toHaveBeenCalled();

        const service = new AdminApiService("http://orbit.test", "service-token");
        mockGet.mockRejectedValueOnce({ response: { status: 404 } });
        expect(await service.getBotQuests("b-1")).toBeNull();
        // A 404 is remembered: Orbit is not asked again for that bot right away.
        expect(await service.getBotQuests("b-1")).toBeNull();
        expect(mockGet).toHaveBeenCalledTimes(1);

        mockGet.mockRejectedValueOnce(new Error("connection refused"));
        expect(await service.getBotQuests("b-3")).toBeNull();
        // A failure is not remembered: the next conversation tries again.
        mockGet.mockResolvedValueOnce({ data: LIST });
        expect(await service.getBotQuests("b-3")).toEqual(LIST);
    });

    it("answers null for a list that is not in the expected shape", async () => {
        mockGet.mockResolvedValue({ data: { unexpected: true } });
        const service = new AdminApiService("http://orbit.test", "service-token");
        expect(await service.getBotQuests("b-1")).toBeNull();
    });
});
