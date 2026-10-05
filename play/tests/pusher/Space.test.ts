import { FilterType, SpaceUser } from "@workadventure/messages";
import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import type { ApiClientRepository } from "@workadventure/shared-utils/src/ApiClientRepository";
import { EventProcessor } from "../../src/pusher/models/EventProcessor";
import type { SpaceForSpaceConnectionInterface } from "../../src/pusher/models/Space";
import { Space } from "../../src/pusher/models/Space";
import type { BackSpaceConnection } from "../../src/pusher/models/Websocket/SocketData";
import type { Socket } from "../../src/pusher/services/SocketManager";
import type { SpaceToFrontDispatcher } from "../../src/pusher/models/SpaceToFrontDispatcher";
import type { SpaceToBackForwarder } from "../../src/pusher/models/SpaceToBackForwarder";
import type { SpaceConnectionInterface } from "../../src/pusher/models/SpaceConnection";
import { SpaceConnection } from "../../src/pusher/models/SpaceConnection";

const flushPromises = () => new Promise(setImmediate);

vi.mock("../../src/pusher/enums/EnvironmentVariable.ts", () => {
    return {
        API_URL: "http://localhost:3000",
    };
});

describe("Space", () => {
    describe("handleWatch", () => {
        it("should send all users to the new watcher", async () => {
            const callbackMap = new Map<string, (...args: unknown[]) => void>();

            const mockWriteFunction = vi.fn();

            const mockBackSpaceConnection = mock<BackSpaceConnection>({
                write: mockWriteFunction,
                on: vi.fn().mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
                    callbackMap.set(event, callback);
                    return mockBackSpaceConnection;
                }),
            });

            const mockUsers = [
                {
                    ...SpaceUser.fromPartial({
                        spaceUserId: "foo_1",
                    }),
                    lowercaseName: "foo_1",
                },
                {
                    ...SpaceUser.fromPartial({
                        spaceUserId: "foo_2",
                    }),
                    lowercaseName: "foo_2",
                },
                {
                    ...SpaceUser.fromPartial({
                        spaceUserId: "foo_3",
                    }),
                    lowercaseName: "foo_3",
                },
            ];

            const mockSyncLocalUsersWithServer = vi.fn();

            const mockSpaceToBackForwarderFactory = (space: Space) =>
                ({
                    syncLocalUsersWithServer: mockSyncLocalUsersWithServer,
                    addUserToNotify: vi.fn(),
                } as unknown as SpaceToBackForwarder);

            const mockNotifyMeAddUser = vi.fn();
            const mockNotifyMeInit = vi.fn();

            const mockSpaceToFrontDispatcherFactory = (space: Space, eventProcessor: EventProcessor) =>
                ({
                    notifyMeAddUser: mockNotifyMeAddUser,
                    notifyMeInit: mockNotifyMeInit,
                } as unknown as SpaceToFrontDispatcher);

            const mockOnBackEndDisconnect = vi.fn();

            const mockSpaceConnection = mock<SpaceConnectionInterface>({
                getSpaceStreamToBackPromise: vi.fn().mockResolvedValue(mockBackSpaceConnection),
                removeSpace: vi.fn(),
            });

            const space = new Space(
                "test",
                "test",
                new EventProcessor(),
                FilterType.ALL_USERS,
                mockOnBackEndDisconnect,
                mockSpaceConnection,
                "world",
                [],
                mockSpaceToBackForwarderFactory,
                mockSpaceToFrontDispatcherFactory
            );

            space.initSpace();

            space.users.set("foo_1", mockUsers[0]);
            space.users.set("foo_2", mockUsers[1]);
            space.users.set("foo_3", mockUsers[2]);

            const mockSocket = mock<Socket>({
                getUserData: vi.fn().mockReturnValue({
                    spaceUser: mockUsers[0],
                }),
            });

            space._localConnectedUserWithSpaceUser.set(mockSocket, mockUsers[0]);

            await flushPromises();

            await space.handleWatch(mockSocket);

            expect(mockNotifyMeInit).toHaveBeenCalledOnce();
        });

        it("should not send users to the new watcher if the user is already watching the space", async () => {
            const callbackMap = new Map<string, (...args: unknown[]) => void>();

            const mockWriteFunction = vi.fn();

            const mockBackSpaceConnection = mock<BackSpaceConnection>({
                write: mockWriteFunction,
                on: vi.fn().mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
                    callbackMap.set(event, callback);
                    return mockBackSpaceConnection;
                }),
            });

            const mockUsers = [
                {
                    ...SpaceUser.fromPartial({
                        spaceUserId: "foo_1",
                    }),
                    lowercaseName: "foo_1",
                },
                {
                    ...SpaceUser.fromPartial({
                        spaceUserId: "foo_2",
                    }),
                    lowercaseName: "foo_2",
                },
                {
                    ...SpaceUser.fromPartial({
                        spaceUserId: "foo_3",
                    }),
                    lowercaseName: "foo_3",
                },
            ];

            const mockSyncLocalUsersWithServer = vi.fn();

            const mockSpaceToBackForwarderFactory = (space: Space) =>
                ({
                    syncLocalUsersWithServer: mockSyncLocalUsersWithServer,
                    addUserToNotify: vi.fn(),
                } as unknown as SpaceToBackForwarder);

            const mockNotifyMeAddUser = vi.fn();
            const mockSpaceToFrontDispatcherFactory = (space: Space, eventProcessor: EventProcessor) =>
                ({
                    notifyMeAddUser: mockNotifyMeAddUser,
                } as unknown as SpaceToFrontDispatcher);

            const mockOnBackEndDisconnect = vi.fn();

            const mockSpaceConnection = mock<SpaceConnectionInterface>({
                getSpaceStreamToBackPromise: vi.fn().mockResolvedValue(mockBackSpaceConnection),
                removeSpace: vi.fn(),
            });

            const space = new Space(
                "test",
                "test",
                new EventProcessor(),
                FilterType.ALL_USERS,
                mockOnBackEndDisconnect,
                mockSpaceConnection,
                "world",
                [],
                mockSpaceToBackForwarderFactory,
                mockSpaceToFrontDispatcherFactory
            );

            space.initSpace();

            space.users.set("foo_1", mockUsers[0]);
            space.users.set("foo_2", mockUsers[1]);
            space.users.set("foo_3", mockUsers[2]);
            space._localWatchers.add("foo_1");

            const mockSocket = mock<Socket>({
                getUserData: vi.fn().mockReturnValue({
                    spaceUser: mockUsers[0],
                }),
            });

            space._localConnectedUserWithSpaceUser.set(mockSocket, mockUsers[0]);

            await flushPromises();

            await space.handleWatch(mockSocket);

            expect(mockNotifyMeAddUser).not.toHaveBeenCalled();
        });
    });
});

describe("SpaceConnection", () => {
    describe("getSpaceStreamToBackPromise", () => {
        it("should create a new spaceStreamToBack if there is no spaceStreamToBack for the backId", async () => {
            const callbackMap = new Map<string, (...args: unknown[]) => void>();

            const mockBackSpaceConnection = mock<BackSpaceConnection>({
                write: vi.fn(),
                on: vi.fn().mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
                    callbackMap.set(event, callback);
                    return mockBackSpaceConnection;
                }),
            });
            const mockGetIndex = vi.fn().mockReturnValue(0);
            const mockWatchSpace = vi.fn().mockReturnValue(mockBackSpaceConnection);
            const mockGetSpaceClient = vi.fn().mockResolvedValue({
                watchSpace: mockWatchSpace,
            });
            const mockApiClientRepository = mock<ApiClientRepository>({
                getSpaceClient: mockGetSpaceClient,
                getIndex: mockGetIndex,
            });

            const mock_GRPC_MAX_MESSAGE_SIZE = 0;

            const spaceConnection = new SpaceConnection(mockApiClientRepository, mock_GRPC_MAX_MESSAGE_SIZE);

            const mockSpace = mock<SpaceForSpaceConnectionInterface>({
                name: "test",
            });

            const BackSpaceConnectionPromise = spaceConnection.getSpaceStreamToBackPromise(mockSpace);

            await flushPromises();

            expect(BackSpaceConnectionPromise).toBeDefined();
            expect(mockGetIndex).toHaveBeenCalledOnce();
            expect(mockGetIndex).toHaveBeenCalledWith(mockSpace.name);

            expect(mockGetSpaceClient).toHaveBeenCalledOnce();
            expect(mockGetSpaceClient).toHaveBeenCalledWith(mockSpace.name, mock_GRPC_MAX_MESSAGE_SIZE);
        });

        it("should create a new spaceStreamToBack if there is no spaceStreamToBack for the backId", async () => {
            const callbackMap = new Map<string, (...args: unknown[]) => void>();

            const mockBackSpaceConnection = mock<BackSpaceConnection>({
                write: vi.fn(),
                on: vi.fn().mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
                    callbackMap.set(event, callback);
                    return mockBackSpaceConnection;
                }),
            });
            const mockGetIndex = vi.fn().mockReturnValue(0);
            const mockWatchSpace = vi.fn().mockReturnValue(mockBackSpaceConnection);
            const mockGetSpaceClient = vi.fn().mockResolvedValue({
                watchSpace: mockWatchSpace,
            });
            const mockApiClientRepository = mock<ApiClientRepository>({
                getSpaceClient: mockGetSpaceClient,
                getIndex: mockGetIndex,
            });

            const mock_GRPC_MAX_MESSAGE_SIZE = 0;

            const spaceConnection = new SpaceConnection(mockApiClientRepository, mock_GRPC_MAX_MESSAGE_SIZE);

            const mockSpace = mock<SpaceForSpaceConnectionInterface>({
                name: "test",
            });

            const mockSpace2 = mock<SpaceForSpaceConnectionInterface>({
                name: "test2",
            });

            const backSpaceConnectionPromise = spaceConnection.getSpaceStreamToBackPromise(mockSpace);

            await flushPromises();

            expect(mockWatchSpace).toHaveBeenCalledOnce();

            expect(backSpaceConnectionPromise).toBeDefined();
            expect(mockGetIndex).toHaveBeenCalledOnce();
            expect(mockGetIndex).toHaveBeenCalledWith(mockSpace.name);

            expect(mockGetSpaceClient).toHaveBeenCalledOnce();
            expect(mockGetSpaceClient).toHaveBeenCalledWith(mockSpace.name, mock_GRPC_MAX_MESSAGE_SIZE);

            const backSpaceConnectionPromise2 = spaceConnection.getSpaceStreamToBackPromise(mockSpace2);
            await flushPromises();

            expect(mockWatchSpace).toHaveBeenCalledOnce();

            expect(backSpaceConnectionPromise).toBeDefined();
            expect(mockGetIndex).toHaveBeenCalledTimes(2);
            expect(mockGetIndex).toHaveBeenNthCalledWith(2, mockSpace2.name);

            expect(mockGetSpaceClient).toHaveBeenCalledOnce();
            expect(backSpaceConnectionPromise2).toStrictEqual(backSpaceConnectionPromise);
        });
        it("should send the joinSpaceMessage to the back when the spaceStreamToBack is created", async () => {
            const callbackMap = new Map<string, (...args: unknown[]) => void>();

            const mockWriteFunction = vi.fn();
            const mockBackSpaceConnection = mock<BackSpaceConnection>({
                write: mockWriteFunction,
                on: vi.fn().mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
                    callbackMap.set(event, callback);
                    return mockBackSpaceConnection;
                }),
            });
            const mockGetIndex = vi.fn().mockReturnValue(0);
            const mockWatchSpace = vi.fn().mockReturnValue(mockBackSpaceConnection);
            const mockGetSpaceClient = vi.fn().mockResolvedValue({
                watchSpace: mockWatchSpace,
            });
            const mockApiClientRepository = mock<ApiClientRepository>({
                getSpaceClient: mockGetSpaceClient,
                getIndex: mockGetIndex,
            });

            const mock_GRPC_MAX_MESSAGE_SIZE = 0;

            const spaceConnection = new SpaceConnection(mockApiClientRepository, mock_GRPC_MAX_MESSAGE_SIZE);

            const mockSpace = mock<SpaceForSpaceConnectionInterface>({
                name: "test",
                filterType: FilterType.ALL_USERS,
                world: "world",
                getPropertiesToSync: vi.fn().mockReturnValue([]),
            });

            await spaceConnection.getSpaceStreamToBackPromise(mockSpace);

            expect(mockWriteFunction).toHaveBeenCalledOnce();
            expect(mockWriteFunction).toHaveBeenCalledWith({
                message: {
                    $case: "joinSpaceMessage",
                    joinSpaceMessage: {
                        spaceName: mockSpace.name,
                        filterType: FilterType.ALL_USERS,
                        world: "world",
                        propertiesToSync: [],
                    },
                },
            });
        });

        it("shouldn't send the joinSpaceMessage to the back  if the space is already joined", async () => {
            const callbackMap = new Map<string, (...args: unknown[]) => void>();

            const mockWriteFunction = vi.fn();
            const mockBackSpaceConnection = mock<BackSpaceConnection>({
                write: mockWriteFunction,
                on: vi.fn().mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
                    callbackMap.set(event, callback);
                    return mockBackSpaceConnection;
                }),
            });
            const mockGetIndex = vi.fn().mockReturnValue(0);
            const mockWatchSpace = vi.fn().mockReturnValue(mockBackSpaceConnection);
            const mockGetSpaceClient = vi.fn().mockResolvedValue({
                watchSpace: mockWatchSpace,
            });
            const mockApiClientRepository = mock<ApiClientRepository>({
                getSpaceClient: mockGetSpaceClient,
                getIndex: mockGetIndex,
            });

            const mock_GRPC_MAX_MESSAGE_SIZE = 0;

            const spaceConnection = new SpaceConnection(mockApiClientRepository, mock_GRPC_MAX_MESSAGE_SIZE);

            const mockSpace = mock<SpaceForSpaceConnectionInterface>({
                name: "test",
                filterType: FilterType.ALL_USERS,
                getPropertiesToSync: vi.fn().mockReturnValue([]),
            });

            const mockSpace2 = mock<SpaceForSpaceConnectionInterface>({
                name: "test2",
                filterType: FilterType.ALL_USERS,
                getPropertiesToSync: vi.fn().mockReturnValue([]),
            });

            await spaceConnection.getSpaceStreamToBackPromise(mockSpace);
            await spaceConnection.getSpaceStreamToBackPromise(mockSpace2);

            expect(mockWatchSpace).toHaveBeenCalledOnce();
            expect(mockGetSpaceClient).toHaveBeenCalledOnce();
        });
    });

    describe("removeSpace", () => {
        it("should return silently if list of space for back id is not found", () => {
            const mockGetIndex = vi.fn().mockReturnValue(0);
            const mockApiClientRepository = mock<ApiClientRepository>({
                getIndex: mockGetIndex,
            });

            const mock_GRPC_MAX_MESSAGE_SIZE = 0;

            const spaceConnection = new SpaceConnection(mockApiClientRepository, mock_GRPC_MAX_MESSAGE_SIZE);

            const mockSpace = mock<SpaceForSpaceConnectionInterface>({
                name: "test",
                filterType: FilterType.ALL_USERS,
            });

            spaceConnection.removeSpace(mockSpace);
        });
        it("should throw an error if space is not found in the list of space for back id", () => {
            const mockGetIndex = vi.fn().mockReturnValue(0);
            const mockApiClientRepository = mock<ApiClientRepository>({
                getIndex: mockGetIndex,
            });

            const mock_GRPC_MAX_MESSAGE_SIZE = 0;

            const spaceConnection = new SpaceConnection(mockApiClientRepository, mock_GRPC_MAX_MESSAGE_SIZE);

            (
                spaceConnection as unknown as {
                    spacePerBackId: Map<number, Map<string, SpaceForSpaceConnectionInterface>>;
                }
            ).spacePerBackId.set(0, new Map<string, SpaceForSpaceConnectionInterface>());

            const mockSpace = mock<SpaceForSpaceConnectionInterface>({
                name: "test",
                filterType: FilterType.ALL_USERS,
            });

            expect(() => spaceConnection.removeSpace(mockSpace)).toThrow();
        });
        it("should end the connection if the list of space for back id is empty", async () => {
            const mockGetIndex = vi.fn().mockReturnValue(0);
            const mockApiClientRepository = mock<ApiClientRepository>({
                getIndex: mockGetIndex,
            });
            const mockEndFunction = vi.fn();
            const mockBackSpaceConnection = mock<BackSpaceConnection>({
                end: mockEndFunction,
            });

            const mockSpace = mock<SpaceForSpaceConnectionInterface>({
                name: "test",
                filterType: FilterType.ALL_USERS,
            });

            const mock_GRPC_MAX_MESSAGE_SIZE = 0;

            const spaceConnection = new SpaceConnection(mockApiClientRepository, mock_GRPC_MAX_MESSAGE_SIZE);

            (
                spaceConnection as unknown as {
                    spacePerBackId: Map<number, Map<string, SpaceForSpaceConnectionInterface>>;
                }
            ).spacePerBackId.set(0, new Map<string, SpaceForSpaceConnectionInterface>([["test", mockSpace]]));
            (
                spaceConnection as unknown as { spaceStreamToBackPromises: Map<number, Promise<BackSpaceConnection>> }
            ).spaceStreamToBackPromises.set(0, Promise.resolve(mockBackSpaceConnection));
            spaceConnection.removeSpace(mockSpace);

            await flushPromises();

            expect(mockEndFunction).toHaveBeenCalledOnce();
            expect(
                (
                    spaceConnection as unknown as {
                        spacePerBackId: Map<number, Map<string, SpaceForSpaceConnectionInterface>>;
                    }
                ).spacePerBackId.get(0)
            ).toBeUndefined();
            expect(
                (
                    spaceConnection as unknown as {
                        spaceStreamToBackPromises: Map<number, Promise<BackSpaceConnection>>;
                    }
                ).spaceStreamToBackPromises.get(0)
            ).toBeUndefined();
        });
        it("should throw an error if back connection is not found", () => {
            const mockGetIndex = vi.fn().mockReturnValue(0);
            const mockApiClientRepository = mock<ApiClientRepository>({
                getIndex: mockGetIndex,
            });

            const mockSpace = mock<SpaceForSpaceConnectionInterface>({
                name: "test",
                filterType: FilterType.ALL_USERS,
            });

            const mock_GRPC_MAX_MESSAGE_SIZE = 0;

            const spaceConnection = new SpaceConnection(mockApiClientRepository, mock_GRPC_MAX_MESSAGE_SIZE);

            (
                spaceConnection as unknown as {
                    spacePerBackId: Map<number, Map<string, SpaceForSpaceConnectionInterface>>;
                }
            ).spacePerBackId.set(0, new Map<string, SpaceForSpaceConnectionInterface>([["test", mockSpace]]));
            expect(() => spaceConnection.removeSpace(mockSpace)).toThrow();
        });
    });
});

describe("Space.applyAndGetUpdatedFieldsForUserFromUpdateSpaceUserMessage", () => {
    const makeSpace = () => {
        const mockSpaceConnection = mock<SpaceConnectionInterface>({
            getSpaceStreamToBackPromise: vi.fn(),
            removeSpace: vi.fn(),
        });
        const space = new Space(
            "test",
            "test",
            new EventProcessor(),
            FilterType.ALL_USERS,
            vi.fn(),
            mockSpaceConnection,
            "world",
            [],
            () => ({} as unknown as SpaceToBackForwarder),
            () => ({} as unknown as SpaceToFrontDispatcher)
        );

        const alice = {
            ...SpaceUser.fromPartial({
                spaceUserId: "alice_1",
                uuid: "alice-uuid",
                name: "Alice",
                tags: ["member"],
                playUri: "https://play.example.com/@/world/room",
                visitCardUrl: "https://orbit.example.com/api/profile/alice?embed=true",
            }),
            lowercaseName: "alice",
        };
        const bob = {
            ...SpaceUser.fromPartial({ spaceUserId: "bob_1", uuid: "bob-uuid", name: "Bob" }),
            lowercaseName: "bob",
        };
        const aliceSocket = mock<Socket>({ getUserData: vi.fn().mockReturnValue({ spaceUserId: "alice_1" }) });
        const bobSocket = mock<Socket>({ getUserData: vi.fn().mockReturnValue({ spaceUserId: "bob_1" }) });
        space._localConnectedUserWithSpaceUser.set(aliceSocket, alice);
        space._localConnectedUserWithSpaceUser.set(bobSocket, bob);
        space._localConnectedUser.set("alice_1", aliceSocket);
        space._localConnectedUser.set("bob_1", bobSocket);
        return { space, alice, bob, aliceSocket };
    };

    it("keeps the media fields the front sends", () => {
        const { space, alice, aliceSocket } = makeSpace();

        const result = space.applyAndGetUpdatedFieldsForUserFromUpdateSpaceUserMessage(aliceSocket, {
            spaceName: "world.test",
            user: SpaceUser.fromPartial({ spaceUserId: "alice_1", microphoneState: true, cameraState: true }),
            updateMask: ["microphoneState", "cameraState"],
        });

        expect(result).toEqual({
            changedFields: ["microphoneState", "cameraState"],
            partialSpaceUser: { spaceUserId: "alice_1", microphoneState: true, cameraState: true },
        });
        expect(alice.microphoneState).toBe(true);
        expect(alice.cameraState).toBe(true);
    });

    it("never lets a client change the fields set by the server", () => {
        const { space, alice, aliceSocket } = makeSpace();

        const result = space.applyAndGetUpdatedFieldsForUserFromUpdateSpaceUserMessage(aliceSocket, {
            spaceName: "world.test",
            user: SpaceUser.fromPartial({
                spaceUserId: "alice_1",
                name: "Khalid",
                uuid: "khalid-uuid",
                tags: ["admin"],
                isLogged: true,
                playUri: "javascript:alert(1)//",
                visitCardUrl: "javascript:alert(1)//",
                chatID: "@khalid:example.com",
                screenSharingState: true,
            }),
            updateMask: [
                "name",
                "uuid",
                "tags",
                "isLogged",
                "playUri",
                "visitCardUrl",
                "chatID",
                "spaceUserId",
                "screenSharingState",
            ],
        });

        expect(result).toEqual({
            changedFields: ["screenSharingState"],
            partialSpaceUser: { spaceUserId: "alice_1", screenSharingState: true },
        });
        expect(alice.name).toBe("Alice");
        expect(alice.uuid).toBe("alice-uuid");
        expect(alice.tags).toEqual(["member"]);
        expect(alice.playUri).toBe("https://play.example.com/@/world/room");
        expect(alice.visitCardUrl).toBe("https://orbit.example.com/api/profile/alice?embed=true");
        expect(alice.chatID).toBeUndefined();
    });

    it("returns nothing when only read-only fields are sent", () => {
        const { space, aliceSocket } = makeSpace();

        const result = space.applyAndGetUpdatedFieldsForUserFromUpdateSpaceUserMessage(aliceSocket, {
            spaceName: "world.test",
            user: SpaceUser.fromPartial({ spaceUserId: "alice_1", name: "Khalid" }),
            updateMask: ["name"],
        });

        expect(result).toBeNull();
    });

    it("applies the update to the sender, never to the user named in the message", () => {
        const { space, alice, bob, aliceSocket } = makeSpace();

        const result = space.applyAndGetUpdatedFieldsForUserFromUpdateSpaceUserMessage(aliceSocket, {
            spaceName: "world.test",
            user: SpaceUser.fromPartial({ spaceUserId: "bob_1", microphoneState: true }),
            updateMask: ["microphoneState"],
        });

        expect(result?.partialSpaceUser.spaceUserId).toBe("alice_1");
        expect(alice.microphoneState).toBe(true);
        expect(bob.microphoneState).toBe(false);
    });
});

describe("Space megaphone right", () => {
    const makeLiveSpace = (localName: string, socketData: Record<string, unknown>) => {
        const space = new Space(
            `world.${localName}`,
            localName,
            new EventProcessor(),
            FilterType.LIVE_STREAMING_USERS,
            vi.fn(),
            mock<SpaceConnectionInterface>({ getSpaceStreamToBackPromise: vi.fn(), removeSpace: vi.fn() }),
            "world",
            [],
            () => ({} as unknown as SpaceToBackForwarder),
            () => ({} as unknown as SpaceToFrontDispatcher)
        );
        const alice = {
            ...SpaceUser.fromPartial({ spaceUserId: "alice_1", uuid: "alice-uuid", name: "Alice" }),
            lowercaseName: "alice",
        };
        const aliceSocket = mock<Socket>({
            getUserData: vi.fn().mockReturnValue({ spaceUserId: "alice_1", ...socketData }),
        });
        space._localConnectedUserWithSpaceUser.set(aliceSocket, alice);
        space._localConnectedUser.set("alice_1", aliceSocket);
        return { space, alice, aliceSocket };
    };

    const goLive = (megaphoneState: boolean) => ({
        spaceName: "world.any",
        user: SpaceUser.fromPartial({ spaceUserId: "alice_1", megaphoneState, microphoneState: true }),
        updateMask: ["megaphoneState", "microphoneState"],
    });

    it("refuses going live in the megaphone space without the megaphone right", () => {
        const { space, alice, aliceSocket } = makeLiveSpace("host-megaphone-news", {
            megaphoneSpaceName: "host-megaphone-news",
            canUseMegaphone: false,
        });

        const result = space.applyAndGetUpdatedFieldsForUserFromUpdateSpaceUserMessage(aliceSocket, goLive(true));

        expect(result?.changedFields).toEqual(["microphoneState"]);
        expect(alice.megaphoneState).toBe(false);
    });

    it("lets a player with the megaphone right go live in the megaphone space", () => {
        const { space, alice, aliceSocket } = makeLiveSpace("host-megaphone-news", {
            megaphoneSpaceName: "host-megaphone-news",
            canUseMegaphone: true,
        });

        const result = space.applyAndGetUpdatedFieldsForUserFromUpdateSpaceUserMessage(aliceSocket, goLive(true));

        expect(result?.changedFields).toEqual(["megaphoneState", "microphoneState"]);
        expect(alice.megaphoneState).toBe(true);
    });

    it("still lets anyone go live in other live spaces, such as speaker zones", () => {
        const { space, alice, aliceSocket } = makeLiveSpace("abc123-stage", {
            megaphoneSpaceName: "host-megaphone-news",
            canUseMegaphone: false,
        });

        space.applyAndGetUpdatedFieldsForUserFromUpdateSpaceUserMessage(aliceSocket, goLive(true));

        expect(alice.megaphoneState).toBe(true);
    });

    it("always lets a player stop going live", () => {
        const { space, alice, aliceSocket } = makeLiveSpace("host-megaphone-news", {
            megaphoneSpaceName: "host-megaphone-news",
            canUseMegaphone: false,
        });
        alice.megaphoneState = true;

        const result = space.applyAndGetUpdatedFieldsForUserFromUpdateSpaceUserMessage(aliceSocket, goLive(false));

        expect(result?.changedFields).toEqual(["megaphoneState", "microphoneState"]);
        expect(alice.megaphoneState).toBe(false);
    });

    it("refuses going live before the room is joined", () => {
        const { space, alice, aliceSocket } = makeLiveSpace("abc123-stage", {
            megaphoneSpaceName: undefined,
            canUseMegaphone: false,
        });

        space.applyAndGetUpdatedFieldsForUserFromUpdateSpaceUserMessage(aliceSocket, goLive(true));

        expect(alice.megaphoneState).toBe(false);
    });
});
