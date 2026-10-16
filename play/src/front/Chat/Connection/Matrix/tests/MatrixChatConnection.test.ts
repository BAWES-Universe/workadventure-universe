import type { MatrixClient } from "matrix-js-sdk";
import { ClientEvent, EventType, PendingEventOrdering, RoomEvent, SyncState } from "matrix-js-sdk";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { KnownMembership } from "matrix-js-sdk/lib/types";
import type { Readable } from "svelte/store";
import { get, readable, writable } from "svelte/store";
import type { AvailabilityStatus } from "@workadventure/messages";
import { MapStore } from "@workadventure/store-utils";
import { MatrixChatConnection } from "../MatrixChatConnection";
import type { CreateRoomOptions } from "../../ChatConnection";
import type { MatrixChatRoom } from "../MatrixChatRoom";
import type { MatrixRoomFolder } from "../MatrixRoomFolder";
import type { MatrixSecurity } from "../MatrixSecurity";
import type { RequestedStatus } from "../../../../Rules/StatusRules/statusRules";

vi.mock("../../../../Phaser/Game/GameManager", () => {
    return {
        gameManager: {
            getCurrentGameScene: () => ({}),
        },
    };
});

vi.mock("../../../../Phaser/Entity/CharacterLayerManager", () => {
    return {
        CharacterLayerManager: {
            wokaBase64(): Promise<string> {
                return Promise.resolve("");
            },
        },
    };
});

vi.mock("../../../../Enum/EnvironmentVariable.ts", () => {
    return {
        MATRIX_ADMIN_USER: "admin",
        MATRIX_DOMAIN: "domain",
    };
});

vi.mock("../../../Stores/ChatStore.ts", () => {
    return {
        selectedRoomStore: writable(undefined),
    };
});
describe("MatrixChatConnection", () => {
    const flushPromises = () => new Promise(setImmediate);

    const basicStatusStore: Readable<
        | AvailabilityStatus.ONLINE
        | AvailabilityStatus.SILENT
        | AvailabilityStatus.AWAY
        | AvailabilityStatus.JITSI
        | AvailabilityStatus.BBB
        | AvailabilityStatus.DENY_PROXIMITY_MEETING
        | AvailabilityStatus.SPEAKER
        | AvailabilityStatus.LIVEKIT
        | RequestedStatus
    > = {
        subscribe: vi.fn(),
    };

    const basicMockMatrixSecurity = {
        isEncryptionRequiredAndNotSet: false,
    } as unknown as MatrixSecurity;

    const getMatrixConnection = async (
        clientPromise: Promise<MatrixClient>,
        matrixSecurity = basicMockMatrixSecurity
    ) => {
        const matrixChatConnection = new MatrixChatConnection(clientPromise, basicStatusStore, matrixSecurity);
        await matrixChatConnection.init();
        return matrixChatConnection;
    };
    describe("Constructor", () => {
        const directChatRoom = {
            id: "directChatRoom",
            type: "direct",
            myMembership: readable(KnownMembership.Join),
        } as unknown as MatrixChatRoom;
        const InviteDirectChatRoom = {
            id: "InviteDirectChatRoom",
            type: "direct",
            myMembership: readable(KnownMembership.Invite),
        } as unknown as MatrixChatRoom;
        const multipleChatRoom = {
            id: "multipleChatRoom",
            type: "multiple",
            myMembership: readable(KnownMembership.Join),
        } as unknown as MatrixChatRoom;
        const InviteMultipleChatRoom = {
            id: "InviteMultipleChatRoom",
            type: "multiple",
            myMembership: readable(KnownMembership.Invite),
        } as unknown as MatrixChatRoom;

        beforeAll(() => {
            vi.restoreAllMocks();
        });

        it("should contains all room with type direct and KnownMembership = join from roomList in directRooms", async () => {
            const mockMatrixClient = {} as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);
            const matrixChatConnection = await getMatrixConnection(clientPromise);

            //set matrixChatConnection RoomList
            matrixChatConnection["roomList"].set(directChatRoom.id, directChatRoom);
            matrixChatConnection["roomList"].set(InviteDirectChatRoom.id, InviteDirectChatRoom);
            matrixChatConnection["roomList"].set(multipleChatRoom.id, multipleChatRoom);
            matrixChatConnection["roomList"].set(InviteMultipleChatRoom.id, InviteMultipleChatRoom);

            expect(get(matrixChatConnection["directRooms"])).toHaveLength(1);

            matrixChatConnection["roomList"].set(directChatRoom.id + "2", directChatRoom);

            expect(get(matrixChatConnection["directRooms"])).toHaveLength(2);
            expect(get(matrixChatConnection["directRooms"]).includes(directChatRoom)).toBeTruthy();

            expect(get(matrixChatConnection["directRooms"]).includes(InviteMultipleChatRoom)).toBeFalsy();
            expect(get(matrixChatConnection["directRooms"]).includes(multipleChatRoom)).toBeFalsy();
            expect(get(matrixChatConnection["directRooms"]).includes(InviteDirectChatRoom)).toBeFalsy();
        });
        it("should contains all room with type multiple and KnownMembership = join from roomList in rooms", async () => {
            const mockMatrixClient = {} as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);
            const matrixChatConnection = await getMatrixConnection(clientPromise);

            //set matrixChatConnection RoomList
            matrixChatConnection["roomList"].set(directChatRoom.id, directChatRoom);
            matrixChatConnection["roomList"].set(InviteDirectChatRoom.id, InviteDirectChatRoom);
            matrixChatConnection["roomList"].set(multipleChatRoom.id, multipleChatRoom);
            matrixChatConnection["roomList"].set(InviteMultipleChatRoom.id, InviteMultipleChatRoom);

            expect(get(matrixChatConnection["rooms"])).toHaveLength(1);

            matrixChatConnection["roomList"].set(multipleChatRoom.id + "2", multipleChatRoom);

            expect(get(matrixChatConnection["rooms"])).toHaveLength(2);
            expect(get(matrixChatConnection["rooms"]).includes(multipleChatRoom)).toBeTruthy();

            expect(get(matrixChatConnection["rooms"]).includes(InviteMultipleChatRoom)).toBeFalsy();
            expect(get(matrixChatConnection["rooms"]).includes(directChatRoom)).toBeFalsy();
            expect(get(matrixChatConnection["rooms"]).includes(InviteDirectChatRoom)).toBeFalsy();
        });
        it("should contains all room with KnownMembership = invite from roomList in invitations", async () => {
            const mockMatrixClient = {} as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);
            const matrixChatConnection = await getMatrixConnection(clientPromise);

            //set matrixChatConnection RoomList
            matrixChatConnection["roomList"].set(directChatRoom.id, directChatRoom);
            matrixChatConnection["roomList"].set(InviteDirectChatRoom.id, InviteDirectChatRoom);
            matrixChatConnection["roomList"].set(multipleChatRoom.id, multipleChatRoom);
            matrixChatConnection["roomList"].set(InviteMultipleChatRoom.id, InviteMultipleChatRoom);

            expect(get(matrixChatConnection["invitations"])).toHaveLength(2);

            expect(get(matrixChatConnection["invitations"]).includes(InviteMultipleChatRoom)).toBeTruthy();
            expect(get(matrixChatConnection["invitations"]).includes(InviteDirectChatRoom)).toBeTruthy();

            expect(get(matrixChatConnection["invitations"]).includes(multipleChatRoom)).toBeFalsy();
            expect(get(matrixChatConnection["invitations"]).includes(directChatRoom)).toBeFalsy();

            matrixChatConnection["roomList"].set(InviteMultipleChatRoom.id + "2", InviteMultipleChatRoom);
            expect(get(matrixChatConnection["invitations"])).toHaveLength(3);
        });
        it("should set isEncryptionRequiredAndNotSet with value of isEncryptionRequiredAndNotSet from matrixSecurity", async () => {
            const mockMatrixClient = {} as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);

            const mockMatrixSecurity = {
                isEncryptionRequiredAndNotSet: false,
            } as unknown as MatrixSecurity;

            const matrixChatConnection = await getMatrixConnection(clientPromise, mockMatrixSecurity);

            expect(matrixChatConnection["isEncryptionRequiredAndNotSet"]).toBe(
                mockMatrixSecurity.isEncryptionRequiredAndNotSet
            );
        });
        it.each([[true], [false]])(
            "should set isEncryptionRequiredAndNotSet with value of isEncryptionRequiredAndNotSet from matrixSecurity ",
            async (expected) => {
                const mockMatrixClient = {} as unknown as MatrixClient;

                const clientPromise = Promise.resolve(mockMatrixClient);

                const mockMatrixSecurity = {
                    isEncryptionRequiredAndNotSet: expected,
                } as unknown as MatrixSecurity;

                const matrixChatConnection = await getMatrixConnection(clientPromise, mockMatrixSecurity);

                expect(matrixChatConnection["isEncryptionRequiredAndNotSet"]).toBe(expected);
            }
        );

        it("should call startMatrixClient when client promise resolve", async () => {
            const mockMatrixClient = {} as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);

            const startMatrixClientSpy = vi.spyOn(MatrixChatConnection.prototype, "startMatrixClient");

            await getMatrixConnection(clientPromise);

            clientPromise
                .then(() => {
                    expect(startMatrixClientSpy).toHaveBeenCalledOnce();
                })
                .catch((e) => console.error(e));
        });
        it("should not call startMatrixClient when client promise reject", async () => {
            const clientPromise = Promise.reject(new Error(""));

            const startMatrixClientSpy = vi.spyOn(MatrixChatConnection.prototype, "startMatrixClient");

            await getMatrixConnection(clientPromise);

            clientPromise.catch(() => {
                expect(startMatrixClientSpy).not.toHaveBeenCalled();
            });
        });
    });

    describe("startMatrixClient", () => {
        it.each([
            [ClientEvent.Sync],
            [ClientEvent.Room],
            [ClientEvent.DeleteRoom],
            [RoomEvent.MyMembership],
            [RoomEvent.Name],
            ["RoomState.events"],
        ])("should call this.client.on for event %s", async (expectedEventName) => {
            const onMock = vi.fn();
            const mockMatrixClient = {
                isGuest: vi.fn(),
                on: onMock,
                store: {
                    startup: vi.fn(),
                },
                initRustCrypto: vi.fn(),
                startClient: vi.fn(),
                isInitialSyncComplete: vi.fn().mockReturnValue(true),
            } as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);

            const matrixChatConnection = await getMatrixConnection(clientPromise);

            await clientPromise;

            onMock.mockRestore();
            await matrixChatConnection.startMatrixClient();

            expect(onMock.mock.calls.some(([eventName, _]) => eventName === expectedEventName)).toBeTruthy();
        });
        it("should start store from matrix client", async () => {
            const startUpMock = vi.fn();
            const mockMatrixClient = {
                isGuest: vi.fn(),
                on: vi.fn(),
                store: {
                    startup: startUpMock,
                },
                initRustCrypto: vi.fn(),
                startClient: vi.fn(),
                isInitialSyncComplete: vi.fn().mockReturnValue(true),
            } as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);

            const matrixChatConnection = await getMatrixConnection(clientPromise);

            await clientPromise;
            startUpMock.mockRestore();
            await matrixChatConnection.startMatrixClient();

            expect(startUpMock).toHaveBeenCalledOnce();
        });

        it("should init crypto", async () => {
            const initCryptoMock = vi.fn();
            const mockMatrixClient = {
                isGuest: vi.fn(),
                on: vi.fn(),
                store: {
                    startup: vi.fn(),
                },
                initRustCrypto: initCryptoMock,
                startClient: vi.fn(),
                isInitialSyncComplete: vi.fn().mockReturnValue(true),
            } as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);

            const matrixChatConnection = await getMatrixConnection(clientPromise);

            await clientPromise;
            await flushPromises();
            initCryptoMock.mockRestore();
            await matrixChatConnection.startMatrixClient();

            expect(initCryptoMock).toHaveBeenCalledOnce();
        });
        it("should start client with options", async () => {
            const mockStartClient = vi.fn();
            const mockMatrixClient = {
                isGuest: vi.fn(),
                on: vi.fn(),
                store: {
                    startup: vi.fn(),
                },
                initRustCrypto: vi.fn(),
                startClient: mockStartClient,
                isInitialSyncComplete: vi.fn().mockReturnValue(true),
            } as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);

            const matrixChatConnection = await getMatrixConnection(clientPromise);

            await clientPromise;

            await flushPromises();

            mockStartClient.mockRestore();
            await matrixChatConnection.startMatrixClient();

            expect(mockStartClient).toHaveBeenCalledOnce();

            expect(mockStartClient).toHaveBeenCalledWith({
                threadSupport: false,
                pendingEventOrdering: PendingEventOrdering.Detached,
            });
        });
    });

    describe("computeInitialState", () => {
        it("should add encryption option to initial state when encrypt from roomOptions is true", async () => {
            const mockStartClient = vi.fn();
            const mockMatrixClient = {
                isGuest: vi.fn(),
                on: vi.fn(),
                store: {
                    startup: vi.fn(),
                },
                initRustCrypto: vi.fn(),
                startClient: mockStartClient,
                isInitialSyncComplete: vi.fn().mockReturnValue(true),
            } as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);

            const matrixChatConnection = await getMatrixConnection(clientPromise);

            const roomOptions = {
                encrypt: true,
            };

            expect(matrixChatConnection["computeInitialState"](roomOptions)).toContainEqual({
                type: EventType.RoomEncryption,
                content: { algorithm: "m.megolm.v1.aes-sha2" },
            });
        });
        it("should not add encryption option to initial state when encrypt from roomOptions is false", async () => {
            const mockStartClient = vi.fn();
            const mockMatrixClient = {
                isGuest: vi.fn(),
                on: vi.fn(),
                store: {
                    startup: vi.fn(),
                },
                initRustCrypto: vi.fn(),
                startClient: mockStartClient,
                isInitialSyncComplete: vi.fn().mockReturnValue(true),
            } as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);

            const matrixChatConnection = await getMatrixConnection(clientPromise);

            const roomOptions = {
                encrypt: false,
            };

            expect(matrixChatConnection["computeInitialState"](roomOptions)).not.toContainEqual({
                type: EventType.RoomEncryption,
                content: { algorithm: "m.megolm.v1.aes-sha2" },
            });
        });
        it("should add historyVisibility option to initial state when historyVisibility from roomOptions is defined", async () => {
            const mockStartClient = vi.fn();
            const mockMatrixClient = {
                isGuest: vi.fn(),
                on: vi.fn(),
                store: {
                    startup: vi.fn(),
                },
                initRustCrypto: vi.fn(),
                startClient: mockStartClient,
            } as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);

            const matrixChatConnection = await getMatrixConnection(clientPromise);

            const roomOptions = {
                historyVisibility: "joined",
            } as unknown as CreateRoomOptions;

            expect(matrixChatConnection["computeInitialState"](roomOptions)).toContainEqual({
                type: EventType.RoomHistoryVisibility,
                content: { history_visibility: roomOptions.historyVisibility },
            });
        });

        it("should not add historyVisibility option to initial state when historyVisibility from roomOptions is undefined", async () => {
            const mockStartClient = vi.fn();
            const mockMatrixClient = {
                isGuest: vi.fn(),
                on: vi.fn(),
                store: {
                    startup: vi.fn(),
                },
                initRustCrypto: vi.fn(),
                startClient: mockStartClient,
            } as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);

            const matrixChatConnection = await getMatrixConnection(clientPromise);

            const roomOptions = {} as unknown as CreateRoomOptions;

            expect(
                matrixChatConnection["computeInitialState"](roomOptions).find(
                    (option) => option.type === EventType.RoomHistoryVisibility
                )
            ).toEqual(undefined);
        });
    });

    describe("createRoom", () => {
        it("should reject promise when roomOptions is undefined", async () => {
            const mockStartClient = vi.fn();
            const mockMatrixClient = {
                isGuest: vi.fn(),
                on: vi.fn(),
                store: {
                    startup: vi.fn(),
                },
                initRustCrypto: vi.fn(),
                startClient: mockStartClient,
            } as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);

            const matrixChatConnection = await getMatrixConnection(clientPromise);

            await expect(matrixChatConnection.createRoom()).rejects.toThrowError("CreateRoomOptions is empty");
        });

        it("should return client.createRoom Reject error when roomOptions is defined but name is undefined", async () => {
            const expected = {
                room_id: "1",
            };
            const mockStartClient = vi.fn();
            const mockMatrixClient = {
                isGuest: vi.fn(),
                on: vi.fn(),
                store: {
                    startup: vi.fn(),
                },
                initRustCrypto: vi.fn(),
                startClient: mockStartClient,
                createRoom: vi.fn().mockResolvedValue(expected),
            } as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);

            const matrixChatConnection = await getMatrixConnection(clientPromise);

            await clientPromise;

            await expect(matrixChatConnection.createRoom({})).rejects.toThrowError("Room name is undefined");
        });
        it("should return client.createRoom Result when roomOptions is defined", async () => {
            const expected = {
                room_id: "1",
            };
            const mockStartClient = vi.fn();
            const mockMatrixClient = {
                isGuest: vi.fn(),
                off: vi.fn(),
                on: vi.fn((_, callback) => {
                    callback(SyncState.Syncing);
                }),
                once: vi.fn().mockImplementation((_, callback) => {
                    callback(SyncState.Syncing);
                }),
                store: {
                    startup: vi.fn(),
                },
                initRustCrypto: vi.fn(),
                startClient: mockStartClient,
                createRoom: vi.fn().mockResolvedValue(expected),
            } as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);

            const matrixChatConnection = await getMatrixConnection(clientPromise);

            await clientPromise;
            expect(await matrixChatConnection.createRoom({ name: "Test" })).toEqual(expected);
        });
    });
    describe("createDirectRoom", () => {
        it("should return existing direct room when a direct room already exist with this user  ", async () => {
            const expected = {
                room_id: "1",
            };
            const mockStartClient = vi.fn();
            const mockMatrixClient = {
                isGuest: vi.fn(),
                on: vi.fn(),
                store: {
                    startup: vi.fn(),
                },
                initRustCrypto: vi.fn(),
                getUserId: vi.fn().mockReturnValue("@me:matrix.test"),
                startClient: mockStartClient,
                createRoom: vi.fn().mockResolvedValue(expected),
                // The account already lists the room as the chat with Alice.
                getAccountData: vi.fn().mockReturnValue({ getContent: () => ({ AliceID: ["old_direct_room"] }) }),
            } as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);

            const matrixChatConnection = await getMatrixConnection(clientPromise);
            await clientPromise;

            const userId = "AliceID";
            const oldDirectRoom = {
                id: "old_direct_room",
                members: readable([]),
                myMembership: readable(KnownMembership.Join),
            } as unknown as MatrixChatRoom;
            matrixChatConnection["isClientReady"] = true;

            const spyGetDirectRoomFor = vi.spyOn(matrixChatConnection, "getDirectRoomFor");

            spyGetDirectRoomFor.mockImplementation(() => oldDirectRoom);
            matrixChatConnection["addDMRoomInAccountData"] = vi.fn();

            expect(await matrixChatConnection.createDirectRoom(userId)).toEqual(oldDirectRoom);
            //eslint-disable-next-line @typescript-eslint/unbound-method
            expect(mockMatrixClient.createRoom).not.toHaveBeenCalled();
            expect(matrixChatConnection["addDMRoomInAccountData"]).not.toHaveBeenCalled();
        });
        it("should create new room / add it to account data and add it to roomList ", async () => {
            const expected = {
                room_id: "1",
            };
            const mockStartClient = vi.fn();
            const mockMatrixClient = {
                isGuest: vi.fn(),
                off: vi.fn(),
                on: vi.fn().mockImplementation((_, funcToResolve) => {
                    funcToResolve(SyncState.Syncing);
                }),
                once: vi.fn().mockImplementation((_, funcToResolve) => {
                    funcToResolve(SyncState.Syncing);
                }),
                store: {
                    startup: vi.fn(),
                },
                initRustCrypto: vi.fn(),
                getUserId: vi.fn().mockReturnValue("@me:matrix.test"),
                startClient: mockStartClient,
                createRoom: vi.fn().mockResolvedValue(expected),
                getRoom: vi.fn(),
                getAccountData: vi.fn(),
            } as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);

            const matrixChatConnection = await getMatrixConnection(clientPromise);

            await clientPromise;

            const userId = "AliceID";
            matrixChatConnection["isClientReady"] = true;

            const spyGetDirectRoomFor = vi.spyOn(matrixChatConnection, "getDirectRoomFor");
            spyGetDirectRoomFor.mockImplementation(() => undefined);

            matrixChatConnection["createRoom"] = vi.fn().mockResolvedValue({
                room_id: "newRoomId",
            });

            matrixChatConnection["addDMRoomInAccountData"] = vi.fn();

            await matrixChatConnection.createDirectRoom(userId);

            expect(mockMatrixClient["createRoom"]).toHaveBeenCalledOnce();
            // Both people get the same power level.
            expect(mockMatrixClient["createRoom"]).toHaveBeenCalledWith(
                expect.objectContaining({ preset: "trusted_private_chat", is_direct: true })
            );
            expect(matrixChatConnection["addDMRoomInAccountData"]).toHaveBeenCalledOnce();
            //eslint-disable-next-line @typescript-eslint/unbound-method
            expect(mockMatrixClient.getRoom).toHaveBeenCalledOnce();
        });
        it("should never open or create a direct room with yourself", async () => {
            const mockMatrixClient = {
                isGuest: vi.fn(),
                on: vi.fn(),
                store: {
                    startup: vi.fn(),
                },
                initRustCrypto: vi.fn(),
                getUserId: vi.fn().mockReturnValue("@me:matrix.test"),
                startClient: vi.fn(),
                createRoom: vi.fn(),
                getRoom: vi.fn(),
            } as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);
            const matrixChatConnection = await getMatrixConnection(clientPromise);
            await clientPromise;

            // You are a member of every direct room you have: your own id must not pick one of them.
            expect(matrixChatConnection.getDirectRoomFor("@me:matrix.test")).toBeUndefined();
            await expect(matrixChatConnection.createDirectRoom("@me:matrix.test")).rejects.toThrow();
            expect(mockMatrixClient["createRoom"]).not.toHaveBeenCalled();
        });
    });
    describe("searchAccessibleRooms", () => {
        it("should search all public rooms with searchText in the options", async () => {
            const roomSearchText = "roomToSearch";
            const mockStartClient = vi.fn();
            const mockPublicRoom = vi.fn().mockResolvedValue({
                chunk: [],
            });

            const mockMatrixClient = {
                isGuest: vi.fn(),
                on: vi.fn(),
                once: vi.fn().mockImplementation((_, funcToResolve) => {
                    funcToResolve(SyncState.Syncing);
                }),
                store: {
                    startup: vi.fn(),
                },
                initRustCrypto: vi.fn(),
                startClient: mockStartClient,
                createRoom: vi.fn().mockResolvedValue(""),
                getRoom: vi.fn(),
                publicRooms: mockPublicRoom,
            } as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);

            const matrixChatConnection = await getMatrixConnection(clientPromise);

            await clientPromise;
            await flushPromises();

            await matrixChatConnection.searchAccessibleRooms(roomSearchText);

            expect(mockPublicRoom).toHaveBeenCalledOnce();
            expect(mockPublicRoom.mock.calls[0][0].filter.generic_search_term).toEqual(roomSearchText);
        });
        it("should only return rooms that are not in the room list", async () => {
            const roomSearchText = "roomToSearch";
            const mockStartClient = vi.fn();
            const mockPublicRoom = vi.fn().mockResolvedValue({
                chunk: [
                    {
                        room_id: roomSearchText,
                        name: roomSearchText,
                    },
                    {
                        room_id: "Other_room",
                        name: "Other_room",
                    },
                ],
            });

            const mockMatrixClient = {
                isGuest: vi.fn(),
                on: vi.fn(),
                once: vi.fn().mockImplementation((_, funcToResolve) => {
                    funcToResolve(SyncState.Syncing);
                }),
                store: {
                    startup: vi.fn(),
                },
                initRustCrypto: vi.fn(),
                startClient: mockStartClient,
                createRoom: vi.fn().mockResolvedValue(""),
                getRoom: vi.fn(),
                publicRooms: mockPublicRoom,
            } as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);

            const matrixChatConnection = await getMatrixConnection(clientPromise);

            const roomAlreadyInRoomList = {
                id: roomSearchText,
            } as unknown as MatrixChatRoom;

            matrixChatConnection["roomList"].set(roomAlreadyInRoomList.id, roomAlreadyInRoomList);

            await clientPromise;
            await flushPromises();

            const result = await matrixChatConnection.searchAccessibleRooms(roomSearchText);

            expect(result).toContainEqual({
                id: "Other_room",
                name: "Other_room",
            });

            expect(result).not.toContainEqual({
                id: roomSearchText,
                name: roomSearchText,
            });
        });
    });

    describe("joinRoom", () => {
        it("should join new room and set roomlist with new data", async () => {
            const mockGetDMInviter = vi.fn().mockReturnValue(undefined);

            const expected = {
                room_id: "1",
            };
            const mockStartClient = vi.fn();
            const mockMatrixClient = {
                isGuest: vi.fn(),
                off: vi.fn(),
                on: vi.fn().mockImplementation((_, funcToResolve) => {
                    funcToResolve(SyncState.Syncing);
                }),
                once: vi.fn().mockImplementation((_, funcToResolve) => {
                    funcToResolve(SyncState.Syncing);
                }),
                store: {
                    startup: vi.fn(),
                },
                initRustCrypto: vi.fn(),
                startClient: mockStartClient,
                createRoom: vi.fn().mockResolvedValue(expected),
                getRoom: vi.fn().mockReturnValue({
                    getDMInviter: mockGetDMInviter,
                }),
                joinRoom: vi.fn().mockResolvedValue(""),
            } as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);

            vi.mock("../MatrixChatRoom", () => ({
                MatrixChatRoom: vi.fn(),
            }));

            const matrixChatConnection = await getMatrixConnection(clientPromise);

            await clientPromise;

            const roomID = "room-id";

            matrixChatConnection["addDMRoomInAccountData"] = vi.fn();
            await matrixChatConnection.joinRoom(roomID);

            //eslint-disable-next-line @typescript-eslint/unbound-method
            expect(mockMatrixClient.joinRoom).toHaveBeenCalledOnce();
            //eslint-disable-next-line @typescript-eslint/unbound-method
            expect(mockMatrixClient.getRoom).toHaveBeenCalledOnce();
            expect(mockGetDMInviter).toHaveBeenCalledOnce();

            expect(matrixChatConnection["addDMRoomInAccountData"]).not.toHaveBeenCalledOnce();
        });
        it("should add room in account data when user join a direct room", async () => {
            const mockGetDMInviter = vi.fn().mockReturnValue("dmInviterID");

            const expected = {
                room_id: "1",
            };
            const mockStartClient = vi.fn();
            const mockMatrixClient = {
                isGuest: vi.fn(),
                off: vi.fn(),
                on: vi.fn().mockImplementation((_, funcToResolve) => {
                    funcToResolve(SyncState.Syncing);
                }),
                once: vi.fn().mockImplementation((_, funcToResolve) => {
                    funcToResolve(SyncState.Syncing);
                }),
                store: {
                    startup: vi.fn(),
                },
                initRustCrypto: vi.fn(),
                startClient: mockStartClient,
                createRoom: vi.fn().mockResolvedValue(expected),
                getRoom: vi.fn().mockReturnValue({
                    getDMInviter: mockGetDMInviter,
                }),
                joinRoom: vi.fn().mockResolvedValue(""),
            } as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);

            vi.mock("../MatrixChatRoom", () => ({
                MatrixChatRoom: vi.fn(),
            }));

            const matrixChatConnection = await getMatrixConnection(clientPromise);

            await clientPromise;

            const roomID = "room-id";

            matrixChatConnection["addDMRoomInAccountData"] = vi.fn();

            await matrixChatConnection.joinRoom(roomID);
            //eslint-disable-next-line @typescript-eslint/unbound-method
            expect(mockMatrixClient.joinRoom).toHaveBeenCalledOnce();
            //eslint-disable-next-line @typescript-eslint/unbound-method
            expect(mockMatrixClient.getRoom).toHaveBeenCalledOnce();
            expect(mockGetDMInviter).toHaveBeenCalledOnce();

            expect(matrixChatConnection["addDMRoomInAccountData"]).toHaveBeenCalledOnce();
        });

        it("Room not present after synchronization", async () => {
            const expected = {
                room_id: "1",
            };
            const mockStartClient = vi.fn();
            const mockMatrixClient = {
                isGuest: vi.fn(),
                off: vi.fn(),
                on: vi.fn().mockImplementation((_, funcToResolve) => {
                    funcToResolve(SyncState.Syncing);
                }),
                once: vi.fn().mockImplementation((_, funcToResolve) => {
                    funcToResolve(SyncState.Syncing);
                }),
                store: {
                    startup: vi.fn(),
                },
                initRustCrypto: vi.fn(),
                startClient: mockStartClient,
                createRoom: vi.fn().mockResolvedValue(expected),
                getRoom: vi.fn().mockReturnValue(null),
                joinRoom: vi.fn().mockResolvedValue(""),
            } as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);

            vi.mock("../MatrixChatRoom", () => ({
                MatrixChatRoom: vi.fn(),
            }));

            const matrixChatConnection = await getMatrixConnection(clientPromise);

            await clientPromise;

            const roomID = "room-id";

            matrixChatConnection["addDMRoomInAccountData"] = vi.fn();

            await expect(matrixChatConnection.joinRoom(roomID)).rejects.toThrow(
                "Room not present after synchronization"
            );
        });
    });
    describe("addDMRoomInAccountData", () => {
        it("should create and set account data when account data is undefined", async () => {
            const mockStartClient = vi.fn();
            // The account has no list on the server yet.
            const mockReadList = vi
                .fn()
                .mockRejectedValue(Object.assign(new Error("not found"), { data: { errcode: "M_NOT_FOUND" } }));
            const mockSetAccountData = vi.fn();
            const mockMatrixClient = {
                isGuest: vi.fn(),
                on: vi.fn(),
                once: vi.fn().mockImplementation((_, funcToResolve) => {
                    funcToResolve(SyncState.Syncing);
                }),
                store: {
                    startup: vi.fn(),
                },
                initRustCrypto: vi.fn(),
                startClient: mockStartClient,
                createRoom: vi.fn(),
                getRoom: vi.fn().mockReturnValue(null),
                joinRoom: vi.fn().mockResolvedValue(""),
                getSafeUserId: () => "@me:matrix.test",
                http: { authedRequest: mockReadList },
                setAccountData: mockSetAccountData,
            } as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);

            const matrixChatConnection = await getMatrixConnection(clientPromise);

            await clientPromise;

            const userId = "AliceId";
            const roomId = "roomTest";
            await matrixChatConnection["addDMRoomInAccountData"](userId, roomId);

            // The list is read from the server, not from the client's copy that lags behind.
            expect(mockReadList).toHaveBeenCalledOnce();
            //eslint-disable-next-line @typescript-eslint/unbound-method
            expect(mockMatrixClient.setAccountData).toHaveBeenCalledOnce();

            expect(mockSetAccountData.mock.calls[0][0]).toBe("m.direct");
            expect(mockSetAccountData.mock.calls[0][1][userId]).toEqual([roomId]);
        });
        it("should get account data / add new direct room in Account Data and set account data when account data is defined", async () => {
            const userId = "AliceId";
            const roomId = "roomTest";
            const roomId2 = "roomTest2";

            const directRoomAccountData: Record<string, string[]> = { [userId]: [roomId] };

            const mockStartClient = vi.fn();
            const mockReadList = vi.fn().mockResolvedValue(directRoomAccountData);
            const mockSetAccountData = vi.fn();
            const mockMatrixClient = {
                isGuest: vi.fn(),
                on: vi.fn(),
                once: vi.fn().mockImplementation((_, funcToResolve) => {
                    funcToResolve(SyncState.Syncing);
                }),
                store: {
                    startup: vi.fn(),
                },
                initRustCrypto: vi.fn(),
                startClient: mockStartClient,
                createRoom: vi.fn(),
                getRoom: vi.fn().mockReturnValue(null),
                joinRoom: vi.fn().mockResolvedValue(""),
                getSafeUserId: () => "@me:matrix.test",
                http: { authedRequest: mockReadList },
                setAccountData: mockSetAccountData,
            } as unknown as MatrixClient;

            const clientPromise = Promise.resolve(mockMatrixClient);

            const matrixChatConnection = await getMatrixConnection(clientPromise);

            await clientPromise;

            await matrixChatConnection["addDMRoomInAccountData"](userId, roomId2);

            // The list is read from the server, not from the client's copy that lags behind.
            expect(mockReadList).toHaveBeenCalledOnce();
            //eslint-disable-next-line @typescript-eslint/unbound-method
            expect(mockMatrixClient.setAccountData).toHaveBeenCalledOnce();

            expect(mockSetAccountData.mock.calls[0][0]).toBe("m.direct");
            expect(mockSetAccountData.mock.calls[0][1][userId]).toContain(roomId);
            expect(mockSetAccountData.mock.calls[0][1][userId]).toContain(roomId2);
        });
    });
    describe("a direct chat whose m.direct list arrives after the chat", () => {
        const roomId = "!dm:chat.example.com";

        async function connectionWith(rooms: Record<string, Partial<MatrixChatRoom>>) {
            const matrixRoom = { roomId };
            const client = {
                getRoom: vi.fn().mockReturnValue(matrixRoom),
                getAccountData: vi.fn().mockReturnValue(undefined),
                getUserId: vi.fn().mockReturnValue("@me:matrix.test"),
            } as unknown as MatrixClient;
            const connection = await getMatrixConnection(Promise.resolve(client));
            Object.entries(rooms).forEach(([id, room]) =>
                connection["roomList"].set(id, {
                    id,
                    myMembership: readable("leave"),
                    ...room,
                } as unknown as MatrixChatRoom)
            );
            const created = vi
                .spyOn(
                    connection as unknown as { createAndAddNewRootRoom: (room: unknown) => unknown },
                    "createAndAddNewRootRoom"
                )
                .mockImplementation(() => undefined);
            return { connection, client, matrixRoom, created };
        }

        const event = (type: string) =>
            ({ getType: () => type } as unknown as Parameters<MatrixChatConnection["onAccountDataEvent"]>[0]);

        it("makes a chat again when the m.direct list changes its type, and leaves the others alone", async () => {
            const stale = { hasOutdatedType: () => true, destroy: vi.fn() };
            const current = { hasOutdatedType: () => false, destroy: vi.fn() };
            const { connection, client, matrixRoom, created } = await connectionWith({
                [roomId]: stale,
                other: current,
            });

            connection["onAccountDataEvent"](event(EventType.Direct));

            expect(stale.destroy).toHaveBeenCalledOnce();
            expect(connection["roomList"].has(roomId)).toBe(false);
            //eslint-disable-next-line @typescript-eslint/unbound-method
            expect(client.getRoom).toHaveBeenCalledWith(roomId);
            expect(created).toHaveBeenCalledExactlyOnceWith(matrixRoom);
            expect(current.destroy).not.toHaveBeenCalled();
            expect(connection["roomList"].has("other")).toBe(true);
        });

        describe("inside a folder (#853)", () => {
            /** A folder holding the given chats, and optionally other folders, as the connection sees it. */
            function folderWith(
                rooms: Record<string, Partial<MatrixChatRoom>>,
                subFolders: Record<string, MatrixRoomFolder> = {}
            ) {
                const roomList = new MapStore<string, MatrixChatRoom>();
                Object.entries(rooms).forEach(([id, room]) =>
                    roomList.set(id, { id, ...room } as unknown as MatrixChatRoom)
                );
                const folderList = new MapStore<string, MatrixRoomFolder>();
                Object.entries(subFolders).forEach(([id, folder]) => folderList.set(id, folder));
                return { roomList, folderList } as unknown as MatrixRoomFolder;
            }

            async function connectionWithFolders(folders: Record<string, MatrixRoomFolder>) {
                const connection = await getMatrixConnection(
                    Promise.resolve({
                        getRoom: vi.fn((id: string) => ({ roomId: id })),
                        getAccountData: vi.fn().mockReturnValue(undefined),
                        getUserId: vi.fn().mockReturnValue("@me:matrix.test"),
                    } as unknown as MatrixClient)
                );
                Object.entries(folders).forEach(([id, folder]) => connection["roomFolders"].set(id, folder));
                const made = vi
                    .spyOn(
                        connection as unknown as { createChatRoom: (room: { roomId: string }) => unknown },
                        "createChatRoom"
                    )
                    .mockImplementation((room) => ({ id: room.roomId, made: true }));
                const createdAtRoot = vi
                    .spyOn(
                        connection as unknown as { createAndAddNewRootRoom: (room: unknown) => unknown },
                        "createAndAddNewRootRoom"
                    )
                    .mockImplementation(() => undefined);
                return { connection, made, createdAtRoot };
            }

            it("makes a chat in a folder again in the same folder, not at the top level", async () => {
                const stale = { hasOutdatedType: () => true, destroy: vi.fn() };
                const current = { hasOutdatedType: () => false, destroy: vi.fn() };
                const folder = folderWith({ [roomId]: stale, other: current });
                const { connection, made, createdAtRoot } = await connectionWithFolders({ folder });
                const untouched = folder.roomList.get("other");

                connection["onAccountDataEvent"](event(EventType.Direct));

                expect(stale.destroy).toHaveBeenCalledOnce();
                expect(made).toHaveBeenCalledExactlyOnceWith({ roomId });
                expect(folder.roomList.get(roomId)).toEqual({ id: roomId, made: true });
                expect(folder.roomList.get("other")).toBe(untouched);
                expect(current.destroy).not.toHaveBeenCalled();
                expect(createdAtRoot).not.toHaveBeenCalled();
                expect(connection["roomList"].has(roomId)).toBe(false);
            });

            it("also looks inside folders that sit in other folders", async () => {
                const stale = { hasOutdatedType: () => true, destroy: vi.fn() };
                const inner = folderWith({ [roomId]: stale });
                const outer = folderWith({}, { inner });
                const { connection, createdAtRoot } = await connectionWithFolders({ outer });

                connection["onAccountDataEvent"](event(EventType.Direct));

                expect(inner.roomList.get(roomId)).toEqual({ id: roomId, made: true });
                expect(outer.roomList.has(roomId)).toBe(false);
                expect(createdAtRoot).not.toHaveBeenCalled();
            });

            it("leaves chats in folders alone when their type is up to date", async () => {
                const current = { hasOutdatedType: () => false, destroy: vi.fn() };
                const folder = folderWith({ [roomId]: current });
                const { connection, made } = await connectionWithFolders({ folder });
                const untouched = folder.roomList.get(roomId);

                connection["onAccountDataEvent"](event(EventType.Direct));

                expect(made).not.toHaveBeenCalled();
                expect(current.destroy).not.toHaveBeenCalled();
                expect(folder.roomList.get(roomId)).toBe(untouched);
            });
        });

        it("does nothing for other account data", async () => {
            const stale = { hasOutdatedType: vi.fn(() => true), destroy: vi.fn() };
            const { connection, created } = await connectionWith({ [roomId]: stale });

            connection["onAccountDataEvent"](event("m.push_rules_other"));

            expect(stale.hasOutdatedType).not.toHaveBeenCalled();
            expect(stale.destroy).not.toHaveBeenCalled();
            expect(created).not.toHaveBeenCalled();
        });
    });
});
