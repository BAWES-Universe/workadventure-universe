import { afterEach, describe, expect, it, vi } from "vitest";
import { MapDataService } from "../server/MapDataService";
import { AIService } from "../ai/AIService";

vi.mock("../client/BotClient", () => ({ BotClient: vi.fn() }));

const roomUrl = "https://play.example/@/universe/world/room";

function area(name: string, description?: unknown, searchable = true) {
    return {
        name,
        x: 32,
        y: 64,
        width: 96,
        height: 128,
        properties: [{ type: "areaDescriptionProperties", searchable, description }],
    };
}

function loadMap(areas: ReturnType<typeof area>[]) {
    const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ mapUrl: "map.tmj", areas }) })
        .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                width: 1,
                height: 1,
                tilewidth: 32,
                tileheight: 32,
                layers: [{ type: "tilelayer", name: "collision", data: [0] }],
            }),
        });
    vi.stubGlobal("fetch", fetchMock);
    return { mapData: new MapDataService("https://maps.example"), fetchMock };
}

afterEach(() => vi.unstubAllGlobals());

describe("listed area descriptions", () => {
    it("passes the WAM description through extraction, the tool, and the model's follow-up text", async () => {
        const { mapData, fetchMock } = loadMap([
            area("Reading corner", "  quiet seats by the window, no calls  "),
            area("Lobby"),
            area("Hidden", "Private room", false),
        ]);
        const areas = await mapData.getAreas(roomUrl);
        expect(areas).toHaveLength(2);
        expect(areas[0]).toMatchObject({
            name: "Reading corner",
            x: 32,
            y: 64,
            width: 96,
            height: 128,
            description: "quiet seats by the window, no calls",
        });
        expect(areas[1]).not.toHaveProperty("description");

        const service = new AIService(null!, null!, "", mapData);
        const results = await service["executeToolCalls"](
            [{ id: "areas", name: "get_areas_on_map", arguments: "{}" }],
            { getRoomUrl: () => roomUrl } as never
        );
        expect(results[0].result).toEqual({
            areas: [
                { name: "Reading corner", x: 32, y: 64, description: "quiet seats by the window, no calls" },
                { name: "Lobby", x: 32, y: 64 },
            ],
        });
        const prompt = service["formatToolResults"](results);
        expect(prompt).toContain('Reading corner (description: "quiet seats by the window, no calls")');
        expect(prompt).toContain("Lobby");
        expect(prompt).not.toContain("Private room");
        // The existing shared room cache is reused; no extra fetch per bot/tool call.
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each([undefined, "", " \n\t ", 123, null])("omits empty or non-text descriptions (%j)", async (description) => {
        const { mapData } = loadMap([area("Lobby", description)]);
        expect((await mapData.getAreas(roomUrl))[0]).not.toHaveProperty("description");
    });

    it("caps a trimmed description at 500 characters", async () => {
        const { mapData } = loadMap([area("Reading corner", `  ${"a".repeat(501)}  `)]);
        expect((await mapData.getAreas(roomUrl))[0].description).toBe("a".repeat(500));
    });
    it("keeps what areas are for to a total length and skips areas without text", () => {
        const format = (AIService as never as { formatAreaPurposes: (areas: unknown[]) => string }).formatAreaPurposes;
        expect(format([{ name: "Lobby" }, undefined, { name: "Quiet", description: "no calls" }])).toBe('Quiet: "no calls"');
        const many = Array.from({ length: 10 }, (_, i) => ({ name: `Area ${i}`, description: "x".repeat(400) }));
        const text = format(many);
        expect(text.length).toBeLessThanOrEqual(1500 + many.length * 2);
        expect(text).toContain("Area 0");
        expect(text).not.toContain("Area 9");
    });
});
