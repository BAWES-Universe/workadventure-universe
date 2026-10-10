import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ICreateClientOpts, IndexedDBStore } from "matrix-js-sdk";
import { RemoteIndexedDBStoreBackend } from "matrix-js-sdk/lib/store/indexeddb-remote-backend";
import type { MatrixClientWrapperInterface, MatrixLocalUserStore } from "../MatrixClientWrapper";
import { MatrixClientWrapper } from "../MatrixClientWrapper";

// @vitest-environment jsdom
vi.mock("../AccessSecretStorageDialog.svelte", () => {
    return {};
});

vi.mock("../CreateRecoveryKeyDialog.svelte", () => {
    return {};
});
vi.mock("../InteractiveAuthDialog.svelte", () => {
    return {};
});

vi.mock("../../../Stores/ChatStore.ts", () => {
    return {};
});
// The worker itself only runs in a browser
vi.mock("../matrixIndexedDbWorker?worker&inline", () => {
    return { default: class {} };
});
describe("MatrixClientWrapper", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    describe("initMatrixClient", () => {
        const basicMockClient = {
            login: () => {
                return Promise.resolve({
                    user_id: null,
                    access_token: null,
                    refresh_token: null,
                    device_id: null,
                });
            },
            clearStores: vi.fn(),
            getUser: vi.fn().mockReturnValue({
                displayName: null,
            }),
            setDisplayName: vi.fn(),
        };

        const basicLocalUserStoreMock: MatrixLocalUserStore = {
            getLocalUser: vi.fn().mockReturnValue(null),
            getMatrixDeviceId: vi.fn().mockReturnValue(null),
            getMatrixAccessToken: vi.fn().mockReturnValue(null),
            getMatrixRefreshToken: vi.fn().mockReturnValue(null),
            getMatrixUserId: vi.fn().mockReturnValue(null),
            getMatrixLoginToken: vi.fn().mockReturnValue(null),
            setMatrixDeviceId: vi.fn().mockReturnValue(null),
            setMatrixLoginToken: vi.fn(),
            setMatrixUserId: vi.fn().mockReturnValue(null),
            setMatrixAccessToken: vi.fn(),
            setMatrixRefreshToken: vi.fn(),
            setMatrixAccessTokenExpireDate: vi.fn(),
            getName: vi.fn().mockReturnValue(null),
        } as unknown as MatrixLocalUserStore;

        it("should throw a error when localUserStore uuid is undefined or null", async () => {
            const createClient = vi.fn().mockReturnValue(basicMockClient);

            const matrixBaseURL = "baseUrl";

            const matrixClientWrapperInstance: MatrixClientWrapperInterface = new MatrixClientWrapper(
                matrixBaseURL,
                basicLocalUserStoreMock,
                createClient
            );

            await expect(matrixClientWrapperInstance.initMatrixClient()).rejects.toThrow();
        });

        it("should throw a error when matrix access token is null", async () => {
            const createClient = vi.fn().mockReturnValue(basicMockClient);

            const matrixBaseURL = "testUrl";

            const localUserStoreMock: MatrixLocalUserStore = {
                ...basicLocalUserStoreMock,
                getLocalUser: vi.fn().mockReturnValue({
                    uuid: "myUuid",
                    email: "",
                    isMatrixRegistered: false,
                    matrixUserId: "",
                }),
                getMatrixAccessToken: vi.fn().mockReturnValue(null),
            } as unknown as MatrixLocalUserStore;

            const matrixClientWrapperInstance: MatrixClientWrapperInterface = new MatrixClientWrapper(
                matrixBaseURL,
                localUserStoreMock,
                createClient
            );

            await expect(matrixClientWrapperInstance.initMatrixClient()).rejects.toThrow(
                "Unable to connect to matrix, access token is null"
            );
        });
        it("should throw a error when matrixUserId is null", async () => {
            const createClient = vi.fn().mockReturnValue(basicMockClient);

            const matrixBaseURL = "testUrl";

            const localUserStoreMock: MatrixLocalUserStore = {
                ...basicLocalUserStoreMock,
                getLocalUser: vi.fn().mockReturnValue({
                    uuid: "myUuid",
                    email: "",
                    isMatrixRegistered: false,
                    matrixUserId: "",
                }),
                getMatrixAccessToken: vi.fn().mockReturnValue("accessToken"),
                getMatrixUserId: vi.fn().mockReturnValue(null),
            } as unknown as MatrixLocalUserStore;

            const matrixClientWrapperInstance: MatrixClientWrapperInterface = new MatrixClientWrapper(
                matrixBaseURL,
                localUserStoreMock,
                createClient
            );

            // matrixClientWrapperInstance.initMatrixClient()
            await expect(matrixClientWrapperInstance.initMatrixClient()).rejects.toThrow(
                "Unable to connect to matrix, matrixUserId is null"
            );
        });

        it("should throw a error when matrixDeviceId is null", async () => {
            const createClient = vi.fn().mockReturnValue(basicMockClient);

            const matrixBaseURL = "testUrl";

            const localUserStoreMock: MatrixLocalUserStore = {
                ...basicLocalUserStoreMock,
                getLocalUser: vi.fn().mockReturnValue({
                    uuid: "myUuid",
                    email: "",
                    isMatrixRegistered: false,
                    matrixUserId: "",
                }),
                getMatrixAccessToken: vi.fn().mockReturnValue("accessToken"),
                getMatrixUserId: vi.fn().mockReturnValue("matrixUserId"),
                setMatrixDeviceId: vi.fn().mockReturnValue(null),
            } as unknown as MatrixLocalUserStore;

            const matrixClientWrapperInstance: MatrixClientWrapperInterface = new MatrixClientWrapper(
                matrixBaseURL,
                localUserStoreMock,
                createClient
            );

            // matrixClientWrapperInstance.initMatrixClient()
            await expect(matrixClientWrapperInstance.initMatrixClient()).rejects.toThrow(
                "Unable to connect to matrix, matrixDeviceId is null"
            );
        });

        it("should call clearStore when oldMatrixId !== newMatrixId", async () => {
            const spyClearStore = vi.fn();

            const mockClient = {
                ...basicMockClient,
                login: () => {
                    return Promise.resolve({
                        user_id: "userID",
                        access_token: "accessToken",
                        refresh_token: "refreshToken",
                        device_id: "deviceID",
                    });
                },
                clearStores: spyClearStore,
            };

            const createClient = vi.fn().mockReturnValue(mockClient);

            const matrixBaseURL = "testUrl";

            const localUserStoreMock: MatrixLocalUserStore = {
                ...basicLocalUserStoreMock,
                getMatrixUserId: vi.fn().mockReturnValue("oldID"),
                getMatrixLoginToken: vi.fn().mockReturnValue("loginToken"),
                getMatrixAccessToken: vi.fn().mockReturnValue("accessToken"),
                getLocalUser: vi.fn().mockReturnValue({
                    uuid: "myUuid",
                    email: "",
                    isMatrixRegistered: false,
                    matrixUserId: "matrixIdFromLocalUser",
                }),
                getMatrixDeviceId: vi.fn().mockReturnValue("deviceID"),
            } as unknown as MatrixLocalUserStore;

            // eslint-disable-next-line
            vi.spyOn(MatrixClientWrapper.prototype as any, "matrixWebClientStore").mockReturnValue({});

            const matrixClientWrapperInstance: MatrixClientWrapperInterface = new MatrixClientWrapper(
                matrixBaseURL,
                localUserStoreMock,
                createClient
            );

            await matrixClientWrapperInstance.initMatrixClient();
            expect(spyClearStore).toHaveBeenCalledOnce();
        });
        it("should call final create client with user Information when user have a matrix account", async () => {
            const userId = "Alice";
            const accessToken = "accessToken";
            const refreshToken = "refreshToken";
            const deviceId = "deviceId";
            const matrixBaseURL = "testUrl";

            const mockClient = {
                ...basicMockClient,
                login: () => {
                    return Promise.resolve({
                        user_id: userId,
                        access_token: accessToken,
                        refresh_token: refreshToken,
                        device_id: deviceId,
                    });
                },
            };

            const createClient = vi.fn().mockReturnValue(mockClient);

            const localUserStoreMock: MatrixLocalUserStore = {
                ...basicLocalUserStoreMock,
                getLocalUser: vi.fn().mockReturnValue({
                    uuid: "myUuid",
                    email: "",
                    isMatrixRegistered: false,
                    matrixUserId: "",
                }),
                getMatrixAccessToken: vi.fn().mockReturnValue("AccessToken"),
                getMatrixRefreshToken: vi.fn().mockReturnValue("RefreshToken"),
                getMatrixUserId: vi.fn().mockReturnValue("UserId"),
                getMatrixLoginToken: vi.fn().mockReturnValue("LoginToken"),
            } as unknown as MatrixLocalUserStore;
            const matrixClientWrapperInstance: MatrixClientWrapperInterface = new MatrixClientWrapper(
                matrixBaseURL,
                localUserStoreMock,
                createClient
            );

            await matrixClientWrapperInstance.initMatrixClient();

            // eslint-disable-next-line
            expect(localUserStoreMock.setMatrixLoginToken).toHaveBeenCalledOnce();
            // eslint-disable-next-line
            expect(localUserStoreMock.setMatrixLoginToken).toHaveBeenCalledWith(null);

            expect(createClient).toHaveBeenCalledTimes(2);

            const lastCreateClientArg: ICreateClientOpts = createClient.mock.calls[1][0] as ICreateClientOpts;

            expect(lastCreateClientArg.baseUrl).toBe(matrixBaseURL);
            expect(lastCreateClientArg.deviceId).toBe(deviceId);
            expect(lastCreateClientArg.userId).toBe(userId);
            expect(lastCreateClientArg.accessToken).toBe(accessToken);
            expect(lastCreateClientArg.refreshToken).toBe(refreshToken);
        });

        it("should call create client with 2 crypto callback", async () => {
            const userId = "Alice";
            const accessToken = "accessToken";
            const refreshToken = "refreshToken";
            const deviceId = "deviceId";
            const matrixBaseURL = "testUrl";

            const mockClient = {
                ...basicMockClient,
                login: () => {
                    return Promise.resolve({
                        user_id: userId,
                        access_token: accessToken,
                        refresh_token: refreshToken,
                        device_id: deviceId,
                    });
                },
            };

            const createClient = vi.fn().mockReturnValue(mockClient);

            const localUserStoreMock: MatrixLocalUserStore = {
                ...basicLocalUserStoreMock,
                getLocalUser: vi.fn().mockReturnValue({
                    uuid: "myUuid",
                    email: "",
                    isMatrixRegistered: false,
                    matrixUserId: "",
                }),
                getMatrixAccessToken: vi.fn().mockReturnValue("accessToken"),
                getMatrixRefreshToken: vi.fn().mockReturnValue("refreshToken"),
                getMatrixUserId: vi.fn().mockReturnValue("userId"),
                getMatrixLoginToken: vi.fn().mockReturnValue("loginToken"),
            } as unknown as MatrixLocalUserStore;
            const matrixClientWrapperInstance: MatrixClientWrapperInterface = new MatrixClientWrapper(
                matrixBaseURL,
                localUserStoreMock,
                createClient
            );

            await matrixClientWrapperInstance.initMatrixClient();

            const lastCreateClientArg: ICreateClientOpts = createClient.mock.calls[1][0] as ICreateClientOpts;

            expect(lastCreateClientArg.cryptoCallbacks?.getSecretStorageKey).toBeDefined();
            expect(lastCreateClientArg.cryptoCallbacks?.cacheSecretStorageKey).toBeDefined();
        });
    });

    describe("matrixWebClientStore", () => {
        const localUserStoreMock = {} as unknown as MatrixLocalUserStore;

        beforeEach(() => {
            // An earlier test stubs matrixWebClientStore itself
            vi.restoreAllMocks();
            // jsdom has no IndexedDB; the stores only open it later, on startup()
            vi.stubGlobal("indexedDB", {});
        });

        afterEach(() => {
            vi.unstubAllGlobals();
        });

        it("persists the sync data on a web worker, not on the main thread", () => {
            // jsdom has no Worker: stand in for the browser's
            vi.stubGlobal("Worker", class {});
            const wrapper = new MatrixClientWrapper("baseUrl", localUserStoreMock, vi.fn());

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { matrixStore } = (wrapper as any).matrixWebClientStore("@user:server") as {
                matrixStore: IndexedDBStore;
            };

            // matrix-js-sdk picks the backend from the options: without a workerFactory, persistSyncData (the
            // structured clone of the whole /sync blob) runs on the main thread and freezes the UI for seconds.
            expect(matrixStore.backend).toBeInstanceOf(RemoteIndexedDBStoreBackend);
        });

        it("stays on the main thread where there are no web workers", () => {
            vi.stubGlobal("Worker", undefined);
            const wrapper = new MatrixClientWrapper("baseUrl", localUserStoreMock, vi.fn());

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { matrixStore } = (wrapper as any).matrixWebClientStore("@user:server") as {
                matrixStore: IndexedDBStore;
            };

            expect(matrixStore.backend).not.toBeInstanceOf(RemoteIndexedDBStoreBackend);
        });
    });
});
