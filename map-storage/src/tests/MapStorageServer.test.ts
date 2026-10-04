import { describe, it, vi, expect, beforeEach } from "vitest";
import type { ServerUnaryCall } from "@grpc/grpc-js";
import type { EditMapCommandMessage, EditMapCommandWithKeyMessage } from "@workadventure/messages";
import { GameMap } from "@workadventure/map-editor";
import type { WAMFileFormat } from "@workadventure/map-editor";

vi.hoisted(() => {
    process.env.API_URL = "localhost:50051";
    process.env.PUSHER_URL = "http://localhost";
    process.env.MAP_STORAGE_API_TOKEN = "test";
    process.env.AUTHENTICATION_TOKEN = "test";
});

const { executeCommand, executeEntityCommand, getOrLoadGameMap } = vi.hoisted(() => ({
    executeCommand: vi.fn(),
    executeEntityCommand: vi.fn(),
    getOrLoadGameMap: vi.fn(),
}));

vi.mock("../MapsManager", () => ({
    mapsManager: { executeCommand, getOrLoadGameMap, addCommandToQueue: vi.fn() },
}));
vi.mock("../EntitiesManager", () => ({ entitiesManager: { executeCommand: executeEntityCommand } }));
vi.mock("../Modules/HookManager", () => ({ hookManager: {} }));

import { mapStorageServer } from "../MapStorageServer";

const MAP_URL = "http://localhost/universe/world/room/map.wam";

// A 100x100 personal area owned by "owner", with an object inside it and one outside it
function makeGameMap(): GameMap {
    const wam: WAMFileFormat = {
        version: "1.0.0",
        mapUrl: "./map.tmj",
        areas: [
            {
                id: "personal-area",
                name: "Owner's area",
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                visible: true,
                properties: [
                    {
                        id: "personal-property",
                        type: "personalAreaPropertyData",
                        accessClaimMode: "static",
                        allowedTags: [],
                        ownerId: "owner",
                    },
                ],
            },
        ],
        entities: {
            inside: { x: 10, y: 10, prefabRef: { id: "chair", collectionName: "Furniture" }, properties: [] },
            outside: { x: 500, y: 500, prefabRef: { id: "chair", collectionName: "Furniture" }, properties: [] },
        },
        entityCollections: [],
    } as unknown as WAMFileFormat;
    return new GameMap(
        { layers: [], tilesets: [], width: 10, height: 10, tilewidth: 32, tileheight: 32 } as never,
        wam
    );
}

function send(message: EditMessage, user: { userUUID: string; userCanEdit: boolean }): Promise<string | undefined> {
    return new Promise((resolve) => {
        const request: EditMapCommandWithKeyMessage = {
            mapKey: MAP_URL,
            editMapCommandMessage: { id: "command", editMapMessage: { message } },
            connectedUserTags: [],
            userCanEdit: user.userCanEdit,
            userUUID: user.userUUID,
        };
        mapStorageServer.handleEditMapCommandWithKeyMessage(
            { request } as ServerUnaryCall<EditMapCommandWithKeyMessage, EditMapCommandMessage>,
            (_err, response) => resolve(response?.editMapMessage?.message?.$case)
        );
    });
}

const player = { userUUID: "someone-else", userCanEdit: false };
const owner = { userUUID: "owner", userCanEdit: false };
const editor = { userUUID: "editor", userCanEdit: true };

type EditMessage = NonNullable<EditMapCommandMessage["editMapMessage"]>["message"];

const deleteEntity = (id: string): EditMessage => ({ $case: "deleteEntityMessage", deleteEntityMessage: { id } });

describe("MapStorageServer edit rights", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getOrLoadGameMap.mockResolvedValue(makeGameMap());
    });

    describe("deleteEntityMessage", () => {
        it("refuses a player who can't edit the map", async () => {
            expect(await send(deleteEntity("inside"), player)).toBe("errorCommandMessage");
            expect(await send(deleteEntity("outside"), player)).toBe("errorCommandMessage");
            expect(executeCommand).not.toHaveBeenCalled();
        });

        it("lets the owner of a personal area delete objects inside it, and only there", async () => {
            expect(await send(deleteEntity("inside"), owner)).toBe("deleteEntityMessage");
            expect(await send(deleteEntity("outside"), owner)).toBe("errorCommandMessage");
            expect(executeCommand).toHaveBeenCalledTimes(1);
        });

        it("lets an editor delete any object", async () => {
            expect(await send(deleteEntity("outside"), editor)).toBe("deleteEntityMessage");
            expect(executeCommand).toHaveBeenCalledTimes(1);
        });
    });

    describe("modifyEntityMessage", () => {
        const moveTo = (id: string, x: number, y: number): EditMessage => ({
            $case: "modifyEntityMessage",
            modifyEntityMessage: { id, x, y, width: 10, height: 10, properties: [], modifyProperties: false },
        });

        it("refuses moving an object from outside into the owner's area", async () => {
            expect(await send(moveTo("outside", 20, 20), owner)).toBe("errorCommandMessage");
            expect(executeCommand).not.toHaveBeenCalled();
        });

        it("lets the owner move an object within their area", async () => {
            expect(await send(moveTo("inside", 30, 30), owner)).toBe("modifyEntityMessage");
        });

        it("refuses moving an object so it sticks out of the owner's area", async () => {
            expect(await send(moveTo("inside", 95, 95), owner)).toBe("errorCommandMessage");
            expect(executeCommand).not.toHaveBeenCalled();
        });
    });

    describe("createEntityMessage", () => {
        const create = (x: number, y: number, width: number, height: number): EditMessage => ({
            $case: "createEntityMessage",
            createEntityMessage: {
                id: "new",
                x,
                y,
                width,
                height,
                prefabId: "chair",
                collectionName: "Furniture",
                properties: [],
            },
        });

        it("lets the owner place an object inside their area", async () => {
            expect(await send(create(10, 10, 20, 20), owner)).toBe("createEntityMessage");
        });

        it("checks a tall object as tall, not as wide", async () => {
            // 20 wide and 80 tall fits in the 100x100 area at (0, 10); 80 wide would stick out to the left
            expect(await send(create(0, 10, 20, 80), owner)).toBe("createEntityMessage");
        });

        it("refuses an object whose centre is in the owner's area but whose corner is outside it", async () => {
            // Centre (10, 10) is inside, but the top-left corner (-20, -20) is not, so it couldn't be deleted later
            expect(await send(create(-20, -20, 60, 60), owner)).toBe("errorCommandMessage");
            expect(executeCommand).not.toHaveBeenCalled();
        });
    });

    describe("custom assets and files", () => {
        it.each([
            [
                "deleting a custom asset",
                { $case: "deleteCustomEntityMessage", deleteCustomEntityMessage: { id: "asset" } },
            ],
            [
                "renaming a custom asset",
                {
                    $case: "modifyCustomEntityMessage",
                    modifyCustomEntityMessage: { id: "asset", name: "renamed", tags: [], depthOffset: 0 },
                },
            ],
            [
                "uploading a file",
                {
                    $case: "uploadFileMessage",
                    uploadFileMessage: { id: "upload", name: "x.png", propertyId: "property", file: new Uint8Array() },
                },
            ],
        ])("refuses %s from a player who can't edit the map, even an area owner", async (_label, message) => {
            expect(await send(message as never, owner)).toBe("errorCommandMessage");
            expect(executeEntityCommand).not.toHaveBeenCalled();
        });
    });
});
