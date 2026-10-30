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

// The uploads of the world (#1628), by id
const { uploads } = vi.hoisted(() => ({
    uploads: new Map<string, { ownerId?: string; ownerName?: string }>(),
}));
vi.mock("../Services/CustomEntityCollectionService", () => ({
    CustomEntityCollectionService: class {
        getEntity(id: string) {
            return Promise.resolve(uploads.get(id));
        }
    },
}));
// The world has no other room
vi.mock("../fileSystem", () => ({ fileSystem: { listFiles: () => Promise.resolve([]) } }));

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
            // Copies of uploads: a lamp at the owner's desk, a sign out in the room
            lampAtDesk: { x: 20, y: 20, prefabRef: { id: "lamp", collectionName: "custom entities" }, properties: [] },
            signInRoom: {
                x: 600,
                y: 600,
                prefabRef: { id: "sign", collectionName: "custom entities" },
                properties: [],
            },
        },
        entityCollections: [],
    } as unknown as WAMFileFormat;
    return new GameMap(
        { layers: [], tilesets: [], width: 10, height: 10, tilewidth: 32, tileheight: 32 } as never,
        wam
    );
}

function send(message: EditMessage, user: { userUUID: string; userCanEdit: boolean }): Promise<string | undefined> {
    return sendAndGetMessage(message, user).then((answer) => answer?.$case);
}

function sendAndGetMessage(
    message: EditMessage,
    user: { userUUID: string; userCanEdit: boolean }
): Promise<EditMessage> {
    return new Promise((resolve) => {
        const request: EditMapCommandWithKeyMessage = {
            mapKey: MAP_URL,
            editMapCommandMessage: { id: "command", editMapMessage: { message } },
            connectedUserTags: [],
            userCanEdit: user.userCanEdit,
            userUUID: user.userUUID,
            userName: `${user.userUUID} name`,
        };
        mapStorageServer.handleEditMapCommandWithKeyMessage(
            { request } as ServerUnaryCall<EditMapCommandWithKeyMessage, EditMapCommandMessage>,
            (_err, response) => resolve(response?.editMapMessage?.message)
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
        uploads.clear();
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

        it.each([
            ["zero", 0, 0],
            ["negative", -10, -10],
            ["not a number", NaN, NaN],
            ["infinite", Infinity, Infinity],
            ["huge", 100000, 100000],
        ])(
            "refuses a move that claims a size of %s, since it would pass for any spot",
            async (_name, width, height) => {
                const message: EditMessage = {
                    $case: "modifyEntityMessage",
                    modifyEntityMessage: {
                        id: "inside",
                        x: 95,
                        y: 95,
                        width,
                        height,
                        properties: [],
                        modifyProperties: false,
                    },
                };
                expect(await send(message, owner)).toBe("errorCommandMessage");
                expect(executeCommand).not.toHaveBeenCalled();
            }
        );

        it("lets an editor move an object whatever size is sent", async () => {
            const message: EditMessage = {
                $case: "modifyEntityMessage",
                modifyEntityMessage: {
                    id: "outside",
                    x: 600,
                    y: 600,
                    width: 0,
                    height: 0,
                    properties: [],
                    modifyProperties: false,
                },
            };
            expect(await send(message, editor)).toBe("modifyEntityMessage");
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

        it.each([
            ["zero", 0, 0],
            ["negative", -20, -20],
            ["not a number", NaN, NaN],
            ["infinite", Infinity, Infinity],
            ["huge", 100000, 100000],
        ])(
            "refuses an object that claims a size of %s at the edge of the owner's area",
            async (_name, width, height) => {
                expect(await send(create(95, 95, width, height), owner)).toBe("errorCommandMessage");
                expect(executeCommand).not.toHaveBeenCalled();
            }
        );

        it("lets an editor place an object whatever size is sent", async () => {
            expect(await send(create(600, 600, 0, 0), editor)).toBe("createEntityMessage");
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
            // An upload from before uploaders were recorded
            uploads.set("asset", {});
            expect(await send(message as never, owner)).toBe("errorCommandMessage");
            expect(executeEntityCommand).not.toHaveBeenCalled();
        });
    });

    describe("uploads and their uploader (#1628)", () => {
        const upload = (id: string, variantOf?: string, ownerId?: string): EditMessage => ({
            $case: "uploadEntityMessage",
            uploadEntityMessage: {
                file: new Uint8Array(),
                id,
                name: "Lamp",
                tags: [],
                imagePath: `${id}.png`,
                direction: 0,
                color: "",
                variantOf,
                ownerId,
            } as never,
        });
        const rename = (id: string): EditMessage => ({
            $case: "modifyCustomEntityMessage",
            modifyCustomEntityMessage: { id, name: "renamed", tags: [], depthOffset: 0 },
        });
        const remove = (id: string): EditMessage => ({
            $case: "deleteCustomEntityMessage",
            deleteCustomEntityMessage: { id },
        });

        it("lets someone with a desk upload, and saves them as the uploader whatever the browser sent", async () => {
            const answer = await sendAndGetMessage(upload("lamp", undefined, "editor"), owner);
            expect(answer?.$case).toBe("uploadEntityMessage");
            const message = answer?.$case === "uploadEntityMessage" ? answer.uploadEntityMessage : undefined;
            expect(message?.ownerId).toBe("owner");
            expect(message?.ownerName).toBe("owner name");
        });

        it("refuses an upload from someone with no place they can edit", async () => {
            expect(await send(upload("lamp"), player)).toBe("errorCommandMessage");
            expect(executeEntityCommand).not.toHaveBeenCalled();
        });

        it("saves an editor as the uploader of their uploads", async () => {
            const answer = await sendAndGetMessage(upload("sign"), editor);
            expect(answer?.$case === "uploadEntityMessage" && answer.uploadEntityMessage.ownerId).toBe("editor");
        });

        it("gives a new side the first picture's uploader, and lets only them or an editor add it", async () => {
            uploads.set("lamp", { ownerId: "owner", ownerName: "Owner" });
            uploads.set("sign", { ownerId: "editor", ownerName: "Editor" });

            expect(await send(upload("sign-left", "sign"), owner)).toBe("errorCommandMessage");
            const answer = await sendAndGetMessage(upload("lamp-left", "lamp"), editor);
            const message = answer?.$case === "uploadEntityMessage" ? answer.uploadEntityMessage : undefined;
            expect(message?.ownerId).toBe("owner");
            expect(message?.ownerName).toBe("Owner");
            expect(await send(upload("lamp-right", "lamp"), owner)).toBe("uploadEntityMessage");
        });

        it("lets the uploader rename their upload, and nobody else but editors", async () => {
            uploads.set("lamp", { ownerId: "owner" });
            expect(await send(rename("lamp"), owner)).toBe("modifyCustomEntityMessage");
            expect(await send(rename("lamp"), player)).toBe("errorCommandMessage");
            expect(await send(rename("lamp"), editor)).toBe("modifyCustomEntityMessage");
        });

        it("lets the uploader delete their upload while every copy is at their desk", async () => {
            uploads.set("lamp", { ownerId: "owner" });
            expect(await send(remove("lamp"), player)).toBe("errorCommandMessage");
            expect(await send(remove("lamp"), owner)).toBe("deleteCustomEntityMessage");
        });

        it("leaves an upload with a copy where its uploader can't edit to the editors", async () => {
            uploads.set("sign", { ownerId: "owner" });
            expect(await send(remove("sign"), owner)).toBe("errorCommandMessage");
            expect(executeEntityCommand).not.toHaveBeenCalled();
            expect(await send(remove("sign"), editor)).toBe("deleteCustomEntityMessage");
        });
    });
});
