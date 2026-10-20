import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getBotTelemetry: vi.fn(),
    saveBotTelemetry: vi.fn(),
}));

vi.mock("../services/BotApiService", () => ({ botApiService: mocks }));
vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    return {
        default: readable({
            mapEditor: {
                edit: {
                    bots: {
                        page: {
                            telemetry: {
                                saveFailed: () => "Could not save this.",
                                loadFailed: () => "Could not load this setting.",
                            },
                        },
                    },
                },
            },
        }),
    };
});

import { botTelemetryStore, clearBotTelemetry, loadBotTelemetry, setBotTelemetry } from "./BotTelemetryStore";

describe("BotTelemetryStore", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        clearBotTelemetry();
    });

    it("loads how the bot stands", async () => {
        mocks.getBotTelemetry.mockResolvedValue({ universeHides: false, on: true });
        await loadBotTelemetry("bot-1");
        expect(get(botTelemetryStore)).toEqual({
            botId: "bot-1",
            status: "ready",
            data: { universeHides: false, on: true },
        });
    });

    it("says it could not load when Orbit does not answer", async () => {
        mocks.getBotTelemetry.mockRejectedValue(new Error("down"));
        await loadBotTelemetry("bot-1");
        expect(get(botTelemetryStore)).toEqual({ botId: "bot-1", status: "failed" });
    });

    it("shows a change at once and keeps what Orbit answers", async () => {
        mocks.getBotTelemetry.mockResolvedValue({ universeHides: false, on: true });
        await loadBotTelemetry("bot-1");
        let answer: (value: unknown) => void = () => undefined;
        mocks.saveBotTelemetry.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        const saving = setBotTelemetry("bot-1", false);
        expect(get(botTelemetryStore)?.data).toEqual({ universeHides: false, on: false });
        answer({ universeHides: false, on: false });
        await saving;
        expect(mocks.saveBotTelemetry).toHaveBeenCalledWith("bot-1", false);
        expect(get(botTelemetryStore)).toEqual({
            botId: "bot-1",
            status: "ready",
            data: { universeHides: false, on: false },
        });
    });

    it("goes back to what Orbit holds and says why when a change is refused", async () => {
        mocks.getBotTelemetry.mockResolvedValue({ universeHides: false, on: true });
        await loadBotTelemetry("bot-1");
        mocks.saveBotTelemetry.mockRejectedValue(new Error("Orbit said no"));
        await setBotTelemetry("bot-1", false);
        expect(get(botTelemetryStore)?.data).toEqual({ universeHides: false, on: true });
        expect(get(botTelemetryStore)?.saveError).toBe("Orbit said no");
    });

    it("goes back to what Orbit holds when two quick changes both fail", async () => {
        mocks.getBotTelemetry.mockResolvedValue({ universeHides: false, on: true });
        await loadBotTelemetry("bot-1");
        mocks.saveBotTelemetry.mockRejectedValue(new Error("Orbit said no"));
        await Promise.all([setBotTelemetry("bot-1", false), setBotTelemetry("bot-1", true)]);
        expect(get(botTelemetryStore)?.data).toEqual({ universeHides: false, on: true });
        expect(get(botTelemetryStore)?.saveError).toBe("Orbit said no");
        expect(mocks.saveBotTelemetry).toHaveBeenCalledTimes(2);
    });

    it("asks Orbit what it holds after a failed save, in case the save landed late", async () => {
        mocks.getBotTelemetry.mockResolvedValueOnce({ universeHides: false, on: true });
        await loadBotTelemetry("bot-1");
        mocks.saveBotTelemetry.mockRejectedValue(new Error("timed out"));
        mocks.getBotTelemetry.mockResolvedValueOnce({ universeHides: false, on: false });
        await setBotTelemetry("bot-1", false);
        expect(get(botTelemetryStore)?.data).toEqual({ universeHides: false, on: false });
        expect(get(botTelemetryStore)?.saveError).toBe("timed out");
    });

    it("lets a read wait for a change on its way", async () => {
        mocks.getBotTelemetry.mockResolvedValueOnce({ universeHides: false, on: true });
        await loadBotTelemetry("bot-1");
        let answer: (value: unknown) => void = () => undefined;
        mocks.saveBotTelemetry.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        const saving = setBotTelemetry("bot-1", false);
        mocks.getBotTelemetry.mockResolvedValueOnce({ universeHides: false, on: false });
        const loading = loadBotTelemetry("bot-1");
        await Promise.resolve();
        expect(mocks.getBotTelemetry).toHaveBeenCalledTimes(1);
        answer({ universeHides: false, on: false });
        await Promise.all([saving, loading]);
        expect(mocks.getBotTelemetry).toHaveBeenCalledTimes(2);
        expect(get(botTelemetryStore)?.data).toEqual({ universeHides: false, on: false });
    });

    it("drops a read that a change made while it waited has overtaken", async () => {
        mocks.getBotTelemetry.mockResolvedValueOnce({ universeHides: false, on: true });
        await loadBotTelemetry("bot-1");
        let answerFirst: (value: unknown) => void = () => undefined;
        mocks.saveBotTelemetry
            .mockReturnValueOnce(
                new Promise((resolve) => {
                    answerFirst = resolve;
                })
            )
            .mockResolvedValueOnce({ universeHides: false, on: true });
        let answerRead: (value: unknown) => void = () => undefined;
        mocks.getBotTelemetry.mockReturnValueOnce(
            new Promise((resolve) => {
                answerRead = resolve;
            })
        );
        const first = setBotTelemetry("bot-1", false);
        const loading = loadBotTelemetry("bot-1");
        const second = setBotTelemetry("bot-1", true);
        answerFirst({ universeHides: false, on: false });
        await Promise.all([first, second]);
        // The read was asked before the second change and answers after it: it must not bring the old setting back
        answerRead({ universeHides: false, on: false });
        await loading;
        expect(get(botTelemetryStore)?.data).toEqual({ universeHides: false, on: true });
    });

    it("changes nothing for a bot whose universe has telemetry off", async () => {
        mocks.getBotTelemetry.mockResolvedValue({ universeHides: true, on: false });
        await loadBotTelemetry("bot-1");
        await setBotTelemetry("bot-1", true);
        expect(mocks.saveBotTelemetry).not.toHaveBeenCalled();
        expect(get(botTelemetryStore)?.data).toEqual({ universeHides: true, on: false });
    });
});
