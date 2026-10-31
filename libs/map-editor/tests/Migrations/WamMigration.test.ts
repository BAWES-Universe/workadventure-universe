import { WAMFileFormat } from "@workadventure/map-editor";
import { wamFileMigration } from "@workadventure/map-editor/src/Migrations/WamFileMigration";
import { describe, it, expect } from "vitest";

describe("wamMigration", () => {
    it("should migrate the wam file from V1 to V2", () => {
        const wamFileContent = {
            version: "1.0.0",
            mapUrl: "https://example.com/map.tmj",
            entities: {},
            areas: [],
            entityCollections: [],
        };

        const wamFile = wamFileMigration.migrate(wamFileContent);

        expect(WAMFileFormat.parse(wamFile)).toEqual({
            version: "2.0.0",
            mapUrl: "https://example.com/map.tmj",
            entities: {},
            areas: [],
            entityCollections: [],
        });
    });

    it("should not modify the wam file if it is already up to date", () => {
        const wamFileContent: WAMFileFormat = {
            version: "2.0.0",
            mapUrl: "https://example.com/map.tmj",
            entities: {},
            areas: [],
            entityCollections: [],
        };
        const wamFile = wamFileMigration.migrate(wamFileContent);
        expect(WAMFileFormat.parse(wamFile)).toEqual(wamFileContent);
    });

    it("should throw an error if the wam file is not valid", () => {
        const invalidWamFileContent = {
            version: "1.0.0",
            mapUrl: "https://example.com/map.tmj",
            entities: {},
            areas: {},
        };

        expect(() => WAMFileFormat.parse(wamFileMigration.migrate(invalidWamFileContent))).toThrow();
    });
});

describe("wamMigration drops Jitsi (game #1688)", () => {
    const jitsiArea = {
        id: "a1",
        type: "jitsiRoomProperty",
        roomName: "Board room",
        jitsiRoomConfig: {},
        trigger: "onaction",
    };
    const highlight = { id: "a2", type: "highlight", opacity: 0.6, gradientWidth: 10, duration: 250, color: "#000000" };
    const website = { id: "e2", type: "openWebsite", link: "https://example.com", buttonLabel: "Open the agenda" };

    it("keeps an area and its other settings, without the Jitsi setting", () => {
        const wamFile = wamFileMigration.migrate({
            version: "2.0.0",
            mapUrl: "https://example.com/map.tmj",
            entities: {},
            areas: [
                {
                    id: "area1",
                    name: "Board room",
                    visible: true,
                    x: 0,
                    y: 0,
                    width: 64,
                    height: 64,
                    properties: [jitsiArea, highlight],
                },
                {
                    id: "area2",
                    name: "Old call",
                    visible: true,
                    x: 64,
                    y: 0,
                    width: 32,
                    height: 32,
                    properties: [jitsiArea],
                },
            ],
            entityCollections: [],
        });

        expect(wamFile.areas).toHaveLength(2);
        expect(wamFile.areas[0].name).toBe("Board room");
        expect(wamFile.areas[0].properties.map((p) => p.type)).toEqual(["highlight"]);
        expect(wamFile.areas[1].properties).toEqual([]);
    });

    it("keeps an object and its other actions, without the Jitsi action", () => {
        const wamFile = wamFileMigration.migrate({
            version: "2.0.0",
            mapUrl: "https://example.com/map.tmj",
            entities: {
                screen: {
                    x: 10,
                    y: 20,
                    prefabRef: { collectionName: "Office", id: "BigScreen" },
                    properties: [{ ...jitsiArea, id: "e1", buttonLabel: "Jitsi Room" }, website],
                },
                lonely: {
                    x: 30,
                    y: 20,
                    prefabRef: { collectionName: "Office", id: "BigScreen" },
                    properties: [{ ...jitsiArea, id: "e3" }],
                },
            },
            areas: [],
            entityCollections: [],
        });

        expect(Object.keys(wamFile.entities)).toEqual(["screen", "lonely"]);
        expect(wamFile.entities.screen.properties?.map((p) => p.type)).toEqual(["openWebsite"]);
        expect(wamFile.entities.lonely.properties).toEqual([]);
    });

    it("drops Jitsi from a version 1 file too, even when its Jitsi config is missing", () => {
        const wamFile = wamFileMigration.migrate({
            version: "1.0.0",
            mapUrl: "https://example.com/map.tmj",
            entities: {},
            areas: [
                {
                    id: "area1",
                    name: "Old call",
                    visible: true,
                    x: 0,
                    y: 0,
                    width: 32,
                    height: 32,
                    properties: [{ id: "p1", type: "jitsiRoomProperty", roomName: "Old" }],
                },
            ],
            entityCollections: [],
        });

        expect(wamFile.version).toBe("2.0.0");
        expect(wamFile.areas[0].properties).toEqual([]);
    });
});
