import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { AvailabilityStatus } from "@workadventure/messages";
import { GameMap, GameMapProperties } from "@workadventure/map-editor";
import type { AreaData, WAMFileFormat } from "@workadventure/map-editor";
import type { ITiledMap } from "@workadventure/tiled-map-type-guard";
import type { GameMapFrontWrapper } from "../GameMap/GameMapFrontWrapper";
import { availabilityStatusStore, requestedStatusStore, silentStore } from "../../../Stores/MediaStore";
import { releaseSpawnSilence, seedSpawnSilence } from "../SpawnSilence";

// The wrapper only needs the Phaser name it aliases at import time; its tile and area maths never touch Phaser.
beforeAll(() => {
    vi.stubGlobal("Phaser", { Tilemaps: { TilemapLayer: class {} } });
});
vi.mock("../GameMap/EntitiesManager", () => ({ EntitiesManager: class {} }));
vi.mock("../GameMap/AreasManager", () => ({ AreasManager: class {} }));
vi.mock("../../../Chat/Stores/AreaPresenceStore", () => ({ areaChatRooms: {}, collectAreaChatRoomIds: () => [] }));
vi.mock("../../../Utils/PathfindingManager", () => ({ PathTileType: { Walkable: 0, Collider: 1 } }));

// MediaStore pulls in the browser environment settings; none of them matter here.
vi.hoisted(() => {
    (window as unknown as { env: Record<string, unknown> }).env = {};
});

const TILE = 32;
const SIZE = 12;

function tiles(cells: Array<[number, number]>): number[] {
    const data = new Array<number>(SIZE * SIZE).fill(0);
    for (const [col, row] of cells) data[col + row * SIZE] = 1;
    return data;
}

function tileLayer(name: string, data: number[], properties: Array<{ name: string; type: string; value: unknown }>) {
    return {
        id: 1,
        name,
        type: "tilelayer",
        x: 0,
        y: 0,
        width: SIZE,
        height: SIZE,
        opacity: 1,
        visible: true,
        data,
        properties,
    };
}

const silent = (value: boolean | string) => [{ name: "silent", type: "bool", value }];

const everyTile = (): Array<[number, number]> =>
    Array.from({ length: SIZE * SIZE }, (_, i): [number, number] => [i % SIZE, Math.floor(i / SIZE)]);

function makeMap(layers: unknown[], objects: unknown[] = []): ITiledMap {
    return {
        type: "map",
        version: "1.10",
        tiledversion: "1.10.2",
        orientation: "orthogonal",
        renderorder: "right-down",
        infinite: false,
        compressionlevel: -1,
        nextlayerid: 10,
        nextobjectid: 10,
        width: SIZE,
        height: SIZE,
        tilewidth: TILE,
        tileheight: TILE,
        tilesets: [
            {
                firstgid: 1,
                name: "t",
                image: "t.png",
                imagewidth: 32,
                imageheight: 32,
                tilewidth: 32,
                tileheight: 32,
                tilecount: 1,
                columns: 1,
                margin: 0,
                spacing: 0,
            },
        ],
        layers: [
            tileLayer("floor", tiles(everyTile()), []),
            ...layers,
            {
                id: 9,
                name: "objects",
                type: "objectgroup",
                x: 0,
                y: 0,
                opacity: 1,
                visible: true,
                draw_order: "topdown",
                objects,
            },
        ],
    } as unknown as ITiledMap;
}

function silentArea(id: string, x: number, y: number, width: number, height: number): AreaData {
    return {
        id,
        name: id,
        x,
        y,
        width,
        height,
        visible: true,
        properties: [{ id: `${id}-p`, type: "silent" }],
    } as AreaData;
}

function makeWam(areas: AreaData[]): WAMFileFormat {
    return {
        version: "1.0.0",
        mapUrl: "map.tmj",
        entities: {},
        areas,
        entityCollections: [],
    } as unknown as WAMFileFormat;
}

async function makeWrapper(map: ITiledMap, areas: AreaData[] = []): Promise<GameMapFrontWrapper> {
    const { GameMapFrontWrapper } = await import("../GameMap/GameMapFrontWrapper");
    const wrapper = Object.create(GameMapFrontWrapper.prototype) as Record<string, unknown>;
    const gameMap = new GameMap(map, makeWam(areas));
    Object.assign(wrapper, {
        gameMap,
        entitiesManager: { getProperties: () => new Map() },
        dynamicAreas: new Map(),
        propertiesChangeCallbacks: new Map(),
        lastProperties: new Map(),
        enterLayerCallbacks: [],
        leaveLayerCallbacks: [],
        enterDynamicAreaCallbacks: [],
        leaveDynamicAreaCallbacks: [],
    });
    // Tiled "area" objects, the way the wrapper builds them in its constructor.
    for (const object of gameMap.tiledObjects.filter((o) => o.class === "area")) {
        (wrapper.dynamicAreas as Map<string, unknown>).set(object.name, {
            name: object.name,
            x: object.x,
            y: object.y,
            width: object.width,
            height: object.height,
            properties: (
                wrapper as unknown as { mapTiledPropertiesToDynamicAreaProperties(p: unknown): unknown }
            ).mapTiledPropertiesToDynamicAreaProperties(object.properties ?? []),
        });
    }
    return wrapper as unknown as GameMapFrontWrapper;
}

// Cell (col, row) -> the centre pixel the player sprite sits on.
const at = (col: number, row: number) => ({ x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 - 16 });

describe("silent spawn", () => {
    beforeEach(() => {
        silentStore.setAreaSilent(false);
        silentStore.setOthersSilent(false);
        silentStore.setSpawnSilent(false);
        requestedStatusStore.set(null);
    });

    /** What the map listeners do once a position is evaluated (GameMapPropertiesListener / AreasPropertiesListener). */
    function listen(wrapper: GameMapFrontWrapper): void {
        wrapper.onPropertyChange(GameMapProperties.SILENT, (value) => {
            silentStore.setOthersSilent(!(value === undefined || value === false || value === ""));
        });
        wrapper.onEnterArea((entered) => {
            if (entered.some((area) => area.properties.some((p) => p.type === "silent")))
                silentStore.setAreaSilent(true);
        });
        wrapper.onLeaveArea((left) => {
            if (left.some((area) => area.properties.some((p) => p.type === "silent"))) silentStore.setAreaSilent(false);
        });
    }

    /** The order GameScene follows on a cold load: connect() reads the status, then the post-join setPosition runs. */
    function coldJoin(wrapper: GameMapFrontWrapper, spawn: { x: number; y: number }) {
        listen(wrapper);
        seedSpawnSilence(wrapper, spawn);
        const statusInTheJoin = get(availabilityStatusStore);
        wrapper.setPosition(spawn.x, spawn.y);
        releaseSpawnSilence();
        return { statusInTheJoin, statusAfterJoin: get(availabilityStatusStore) };
    }

    it("joins as silent when the spawn tile is in a silent layer", async () => {
        const map = makeMap([tileLayer("quiet", tiles([[5, 5]]), silent(true))]);
        const wrapper = await makeWrapper(map);

        const { statusInTheJoin, statusAfterJoin } = coldJoin(wrapper, at(5, 5));

        expect(statusInTheJoin).toBe(AvailabilityStatus.SILENT);
        expect(statusAfterJoin).toBe(AvailabilityStatus.SILENT);
    });

    it("joins as online on an ordinary spawn", async () => {
        const map = makeMap([tileLayer("quiet", tiles([[5, 5]]), silent(true))]);
        const wrapper = await makeWrapper(map);

        const { statusInTheJoin, statusAfterJoin } = coldJoin(wrapper, at(6, 5));

        expect(statusInTheJoin).toBe(AvailabilityStatus.ONLINE);
        expect(statusAfterJoin).toBe(AvailabilityStatus.ONLINE);
    });

    it("joins as silent in a Tiled area object and in a map-editor silent area", async () => {
        const object = {
            id: 3,
            name: "quiet",
            class: "area",
            type: "",
            x: 4 * TILE,
            y: 4 * TILE,
            width: 2 * TILE,
            height: 2 * TILE,
            rotation: 0,
            visible: true,
            properties: silent(true),
        };
        const tiled = await makeWrapper(makeMap([], [object]));
        expect(coldJoin(tiled, at(4, 4)).statusInTheJoin).toBe(AvailabilityStatus.SILENT);

        silentStore.setOthersSilent(false);
        const wam = await makeWrapper(makeMap([]), [silentArea("a1", 8 * TILE, 8 * TILE, 2 * TILE, 2 * TILE)]);
        expect(coldJoin(wam, at(8, 8)).statusInTheJoin).toBe(AvailabilityStatus.SILENT);
    });

    it("follows the same override rules as the runtime: a later false layer wins, an empty value is not silent", async () => {
        const overridden = await makeWrapper(
            makeMap([
                tileLayer("quiet", tiles([[5, 5]]), silent(true)),
                tileLayer("open", tiles([[5, 5]]), silent(false)),
            ])
        );
        expect(coldJoin(overridden, at(5, 5)).statusInTheJoin).toBe(AvailabilityStatus.ONLINE);

        const empty = await makeWrapper(makeMap([tileLayer("quiet", tiles([[5, 5]]), silent(""))]));
        expect(coldJoin(empty, at(5, 5)).statusInTheJoin).toBe(AvailabilityStatus.ONLINE);
    });

    it("uses the same boundary as the runtime: the player counts as standing at their feet", async () => {
        // The sprite centre is 16px above the feet. Centre in the row above the zone, feet already inside it.
        const wrapper = await makeWrapper(makeMap([], []), [silentArea("a1", 0, 6 * TILE, 4 * TILE, 2 * TILE)]);
        const spawn = { x: TILE, y: 6 * TILE - 8 };

        expect(wrapper.isSilentAt(spawn.x, spawn.y)).toBe(true);
        expect(wrapper.isSilentAt(spawn.x, spawn.y - 17)).toBe(false);
    });

    it("keeps the existing precedence: do-not-disturb and other blocking states are untouched", async () => {
        requestedStatusStore.set(AvailabilityStatus.DO_NOT_DISTURB);
        const wrapper = await makeWrapper(makeMap([tileLayer("quiet", tiles([[5, 5]]), silent(true))]));

        // Silence already beat a requested status before this change; the manual choice itself is never rewritten.
        expect(coldJoin(wrapper, at(5, 5)).statusInTheJoin).toBe(AvailabilityStatus.SILENT);
        expect(get(requestedStatusStore)).toBe(AvailabilityStatus.DO_NOT_DISTURB);

        silentStore.setOthersSilent(false);
        const plain = await makeWrapper(makeMap([tileLayer("quiet", tiles([[5, 5]]), silent(true))]));
        expect(coldJoin(plain, at(6, 6)).statusInTheJoin).toBe(AvailabilityStatus.DO_NOT_DISTURB);
    });

    it("lets go of the seed once the map has run, so leaving the zone restores the status", async () => {
        const wrapper = await makeWrapper(makeMap([tileLayer("quiet", tiles([[5, 5]]), silent(true))]));
        coldJoin(wrapper, at(5, 5));

        wrapper.setPosition(at(6, 5).x, at(6, 5).y);
        expect(get(availabilityStatusStore)).toBe(AvailabilityStatus.ONLINE);

        wrapper.setPosition(at(5, 5).x, at(5, 5).y);
        expect(get(availabilityStatusStore)).toBe(AvailabilityStatus.SILENT);
    });

    it("does not strand silence when the map ends up not silent after all", async () => {
        const wrapper = await makeWrapper(makeMap([]));
        listen(wrapper);
        silentStore.setSpawnSilent(true);
        expect(get(availabilityStatusStore)).toBe(AvailabilityStatus.SILENT);

        wrapper.setPosition(at(2, 2).x, at(2, 2).y);
        releaseSpawnSilence();

        expect(get(availabilityStatusStore)).toBe(AvailabilityStatus.ONLINE);
    });

    it("does not look at the spawn again once the map has evaluated a position (reconnect)", async () => {
        const wrapper = await makeWrapper(makeMap([tileLayer("quiet", tiles([[5, 5]]), silent(true))]));
        listen(wrapper);
        wrapper.setPosition(at(6, 5).x, at(6, 5).y);

        seedSpawnSilence(wrapper, at(5, 5));

        expect(get(availabilityStatusStore)).toBe(AvailabilityStatus.ONLINE);
    });

    it("has no side effect while resolving the spawn", async () => {
        const wrapper = await makeWrapper(makeMap([tileLayer("quiet", tiles([[5, 5]]), silent(true))]));
        const onSilent = vi.fn();
        wrapper.onPropertyChange(GameMapProperties.SILENT, onSilent);

        expect(wrapper.isSilentAt(at(5, 5).x, at(5, 5).y)).toBe(true);

        expect(onSilent).not.toHaveBeenCalled();
        expect(wrapper.hasPosition()).toBe(false);
    });
});
