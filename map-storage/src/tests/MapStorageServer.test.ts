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

const { executeCommand, executeEntityCommand, getOrLoadGameMap, deleteUploadEverywhere, tellBackServers } = vi.hoisted(
    () => ({
        executeCommand: vi.fn(),
        executeEntityCommand: vi.fn(),
        getOrLoadGameMap: vi.fn(),
        deleteUploadEverywhere: vi.fn(),
        tellBackServers: vi.fn(),
    })
);

vi.mock("../MapsManager", () => ({
    mapsManager: { executeCommand, getOrLoadGameMap, readGameMap: getOrLoadGameMap, addCommandToQueue: vi.fn() },
}));
// Deleting everywhere is tested on its own (UploadDeletion.test.ts): here only who may ask for it.
vi.mock("../Services/UploadDeletion", () => ({ deleteUploadEverywhere }));
// Telling the back servers is tested on its own (UploadDeletionNotifier.test.ts): here only what is told, and when.
vi.mock("../Services/UploadDeletionNotifier", () => ({ uploadDeletionNotifier: { tell: tellBackServers } }));
vi.mock("../EntitiesManager", () => ({ entitiesManager: { executeCommand: executeEntityCommand } }));
vi.mock("../Modules/HookManager", () => ({ hookManager: {} }));

// The uploads of the world (#1628), by id
const { uploads } = vi.hoisted(() => ({
    uploads: new Map<string, { ownerId?: string; ownerName?: string; variantOf?: string; imagePath?: string }>(),
}));
vi.mock("../Services/CustomEntityCollectionService", () => ({
    CustomEntityCollectionService: class {
        getEntity(id: string) {
            return Promise.resolve(uploads.get(id));
        }
        getUploadPictures(id: string) {
            const picture = uploads.get(id);
            if (!picture) return Promise.resolve([]);
            const first = picture.variantOf ?? id;
            return Promise.resolve(
                [...uploads.entries()]
                    .filter(([otherId, other]) => otherId === first || other.variantOf === first)
                    .map(([otherId]) => ({ id: otherId }))
            );
        }
        isTaken(id: string, imagePath: string) {
            return Promise.resolve(
                [...uploads.entries()].some(([otherId, other]) => otherId === id || other.imagePath === imagePath)
            );
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
        const upload = (id: string, variantOf?: string, ownerId?: string, imagePath = `${id}.png`): EditMessage => ({
            $case: "uploadEntityMessage",
            uploadEntityMessage: {
                file: new Uint8Array(),
                id,
                name: "Lamp",
                tags: [],
                imagePath,
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
            deleteCustomEntityMessage: { id, wholeUpload: false, pictureIds: [] },
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

        it("keeps every picture of an upload when another side has a copy where its uploader can't edit", async () => {
            // The lamp sits at the desk, but its other side "sign" was put down out in the room
            uploads.set("lamp", { ownerId: "owner" });
            uploads.set("sign", { ownerId: "owner", variantOf: "lamp" });
            expect(await send(remove("lamp"), owner)).toBe("errorCommandMessage");
            expect(await send(remove("sign"), owner)).toBe("errorCommandMessage");
            expect(executeEntityCommand).not.toHaveBeenCalled();
        });

        describe("deleting an upload everywhere (#1690)", () => {
            const removeEverywhere = (id: string): EditMessage => ({
                $case: "deleteCustomEntityMessage",
                deleteCustomEntityMessage: { id, wholeUpload: true, pictureIds: [] },
            });

            beforeEach(() => {
                deleteUploadEverywhere.mockResolvedValue(["lounge/map.wam"]);
                tellBackServers.mockReset();
                tellBackServers.mockResolvedValue(undefined);
            });

            it("lets an editor delete every picture and every copy, and tells every back server which rooms lost them", async () => {
                uploads.set("lamp", { ownerId: "owner" });
                uploads.set("lamp-red", { ownerId: "owner", variantOf: "lamp" });
                const answer = await sendAndGetMessage(removeEverywhere("lamp"), editor);
                expect(deleteUploadEverywhere).toHaveBeenCalledWith(
                    expect.objectContaining({ pictureIds: ["lamp", "lamp-red"], universeWorldPath: "universe/world" })
                );
                const message =
                    answer?.$case === "deleteCustomEntityMessage" ? answer.deleteCustomEntityMessage : undefined;
                expect(message?.pictureIds).toEqual(["lamp", "lamp-red"]);
                // The back servers get the other rooms and the delete as those rooms receive it
                expect(tellBackServers).toHaveBeenCalledTimes(1);
                const [wamUrls, command] = tellBackServers.mock.calls[0] as [string[], EditMapCommandMessage];
                expect(wamUrls).toEqual(["http://localhost/universe/world/lounge/map.wam"]);
                expect(command.id).toBe("command");
                const told =
                    command.editMapMessage?.message?.$case === "deleteCustomEntityMessage"
                        ? command.editMapMessage.message.deleteCustomEntityMessage
                        : undefined;
                expect(told).toEqual(
                    expect.objectContaining({ id: "lamp", wholeUpload: true, pictureIds: ["lamp", "lamp-red"] })
                );
                expect(executeEntityCommand).not.toHaveBeenCalled();
            });

            it("writes the other rooms' addresses the way the web writes them, so a room with a space in its name is found", async () => {
                uploads.set("lamp", { ownerId: "owner" });
                deleteUploadEverywhere.mockResolvedValue(["my room/map.wam", "100%/map.wam"]);
                await sendAndGetMessage(removeEverywhere("lamp"), editor);
                expect(tellBackServers.mock.calls[0][0]).toEqual([
                    "http://localhost/universe/world/my%20room/map.wam",
                    "http://localhost/universe/world/100%25/map.wam",
                ]);
            });

            it("drops the picture list a browser sends, so no room is told about a delete that didn't happen", async () => {
                uploads.set("lamp", { ownerId: "owner" });
                const crafted = (wholeUpload: boolean): EditMessage => ({
                    $case: "deleteCustomEntityMessage",
                    deleteCustomEntityMessage: {
                        id: "lamp",
                        wholeUpload,
                        pictureIds: ["other"],
                    },
                });
                const single = await sendAndGetMessage(crafted(false), editor);
                const message =
                    single?.$case === "deleteCustomEntityMessage" ? single.deleteCustomEntityMessage : undefined;
                expect(message?.pictureIds).toEqual([]);
                // A refused whole-upload delete tells nobody either
                deleteUploadEverywhere.mockRejectedValue(new Error("Could not write"));
                expect(await send(crafted(true), editor)).toBe("errorCommandMessage");
                expect(tellBackServers).not.toHaveBeenCalled();
            });

            it("still answers the delete when the back servers can't be told", async () => {
                uploads.set("lamp", { ownerId: "owner" });
                tellBackServers.mockRejectedValue(new Error("No back server"));
                expect(await send(removeEverywhere("lamp"), editor)).toBe("deleteCustomEntityMessage");
            });

            it("keeps the rights as they are: the uploader only while every copy is at their desk", async () => {
                uploads.set("lamp", { ownerId: "owner" });
                uploads.set("sign", { ownerId: "owner" });
                expect(await send(removeEverywhere("lamp"), owner)).toBe("deleteCustomEntityMessage");
                expect(await send(removeEverywhere("lamp"), player)).toBe("errorCommandMessage");
                expect(await send(removeEverywhere("sign"), owner)).toBe("errorCommandMessage");
                expect(deleteUploadEverywhere).toHaveBeenCalledTimes(1);
            });

            describe("when a copy appears in another room after the first check", () => {
                // The mock stands for map-storage's delete: once the other rooms are locked it asks the rights again.
                // Between the first check and that one, someone puts a copy of the lamp out in the room.
                beforeEach(() => {
                    deleteUploadEverywhere.mockImplementation(
                        async ({ checkRights }: { checkRights: () => Promise<void> }) => {
                            const map = (await getOrLoadGameMap()) as GameMap;
                            map.getGameMapEntities()?.addEntity("lampInRoom", {
                                x: 700,
                                y: 700,
                                prefabRef: { id: "lamp", collectionName: "custom entities" },
                                properties: [],
                            } as never);
                            await checkRights();
                            return ["lounge/map.wam"];
                        }
                    );
                });

                it("refuses the uploader, who can't edit where the copy is", async () => {
                    uploads.set("lamp", { ownerId: "owner" });
                    expect(await send(removeEverywhere("lamp"), owner)).toBe("errorCommandMessage");
                });

                it("still lets an editor delete", async () => {
                    uploads.set("lamp", { ownerId: "owner" });
                    expect(await send(removeEverywhere("lamp"), editor)).toBe("deleteCustomEntityMessage");
                });
            });

            it("shows the editor's error and deletes nothing when a room can't be changed", async () => {
                uploads.set("lamp", { ownerId: "owner" });
                deleteUploadEverywhere.mockRejectedValue(new Error("Could not write"));
                expect(await send(removeEverywhere("lamp"), editor)).toBe("errorCommandMessage");
            });
        });

        describe("where an upload is placed (#1690)", () => {
            const ask = (id: string, user: { userUUID: string; userCanEdit: boolean }) =>
                new Promise<{ rooms: { wamUrl: string; count: number }[] } | undefined>((resolve) => {
                    mapStorageServer.handleUploadCopiesQuery(
                        {
                            request: {
                                mapKey: MAP_URL,
                                id,
                                connectedUserTags: [],
                                userCanEdit: user.userCanEdit,
                                userUUID: user.userUUID,
                            },
                        } as never,
                        (_err, answer) => resolve(answer ?? undefined)
                    );
                });

            it("counts the copies in this room for an editor, and tells nobody else", async () => {
                uploads.set("lamp", { ownerId: "owner" });
                expect(await ask("lamp", editor)).toEqual({ rooms: [{ wamUrl: MAP_URL, count: 1 }] });
                expect(await ask("lamp", player)).toBeUndefined();
                // The uploader follows the delete rule: not while a copy sits where they can't edit
                uploads.set("lamp", { ownerId: "owner" });
                expect(await ask("lamp", owner)).toEqual({ rooms: [{ wamUrl: MAP_URL, count: 1 }] });
                uploads.set("sign", { ownerId: "owner" });
                expect(await ask("sign", owner)).toBeUndefined();
            });
        });

        it("refuses an upload that would replace a saved picture, unless it comes from an editor", async () => {
            uploads.set("lamp", { ownerId: "editor", imagePath: "lamp.png" });
            // Same id
            expect(await send(upload("lamp"), owner)).toBe("errorCommandMessage");
            // Same file name under a new id
            expect(await send(upload("new", undefined, undefined, "lamp.png"), owner)).toBe("errorCommandMessage");
            expect(executeEntityCommand).not.toHaveBeenCalled();
            expect(await send(upload("lamp"), editor)).toBe("uploadEntityMessage");
        });
    });
});
