import { hostname } from "node:os";
import { inspect } from "node:util";
import type { AxiosInstance, InternalAxiosRequestConfig } from "axios";
import axios from "axios";
import pLimit from "p-limit";
import type { ICreateRoomOpts } from "matrix-js-sdk";
import { EventType, Visibility } from "matrix-js-sdk";
import { slugify } from "@workadventure/shared-utils/src/Jitsi/slugify";
import {
    MATRIX_ADMIN_PASSWORD,
    MATRIX_ADMIN_TOKEN,
    MATRIX_ADMIN_USER,
    MATRIX_API_URI,
    MATRIX_DOMAIN,
} from "../enums/EnvironmentVariable";

const ADMIN_CHAT_ID = `@${MATRIX_ADMIN_USER}:${MATRIX_DOMAIN}`;

// One device per pusher instance: signing in again reuses it instead of adding a new device every time.
const ADMIN_DEVICE_ID = `universe-pusher-${hostname()}`;

/**
 * An axios error carries the request it came from: its Authorization header and, for the password sign-in, the password
 * in its body. Printing it (or turning it into JSON) would put the admin token or password in the logs, so the error
 * shows only what went wrong.
 */
function keepSecretsOutOfLogs(error: unknown): unknown {
    if (axios.isAxiosError(error)) {
        const summary = { name: error.name, message: error.message, status: error.response?.status };
        Object.defineProperty(error, inspect.custom, {
            value: () => `${summary.name}: ${summary.message}${summary.status ? ` (status ${summary.status})` : ""}`,
            configurable: true,
        });
        Object.defineProperty(error, "toJSON", { value: () => summary, configurable: true });
    }
    return error;
}

const limit = pLimit(10);
class MatrixProvider {
    private loginPromise: Promise<string> | undefined;
    // Set once Synapse refuses MATRIX_ADMIN_TOKEN: from then on the password sign-in is used.
    private adminTokenRefused = false;
    private roomAreaFolderName = slugify("current visited room");
    private roomAreaFolderID: string | undefined;

    constructor() {
        this.overrideRateLimitForAdminAccount().catch((error) => {
            console.error("Failed to override admin account ratelimit:", error);
        });

        this.createChatFolderAreaAndSetID()
            .then((roomID) => {
                this.roomAreaFolderID = roomID;
            })
            .catch((error) => {
                console.error("Failed to create chat folder for room area:", error);
            });
    }

    private async getAxios(): Promise<AxiosInstance> {
        const login = this.getAccessToken();
        const accessToken = await login;
        const instance = axios.create({
            baseURL: MATRIX_API_URI,
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
        // The token is kept for the life of the process: if Synapse refuses it, sign in again once and repeat the call.
        instance.interceptors.response.use(undefined, async (error: unknown) => {
            if (!axios.isAxiosError(error) || error.response?.status !== 401 || !error.config) {
                throw keepSecretsOutOfLogs(error);
            }
            const config: InternalAxiosRequestConfig & { signedInAgain?: boolean } = error.config;
            if (config.signedInAgain) {
                throw keepSecretsOutOfLogs(error);
            }
            config.signedInAgain = true;
            if (
                MATRIX_ADMIN_TOKEN &&
                !this.adminTokenRefused &&
                config.headers.Authorization === `Bearer ${MATRIX_ADMIN_TOKEN}`
            ) {
                this.adminTokenRefused = true;
                console.error("Synapse refused MATRIX_ADMIN_TOKEN: signing in with the admin password instead");
            }
            // Calls that failed together with the same token share one new sign-in.
            if (this.loginPromise === login) {
                this.loginPromise = undefined;
            }
            config.headers.Authorization = `Bearer ${await this.getAccessToken()}`;
            return instance.request(config);
        });
        return instance;
    }

    getMatrixIdFromEmail(email: string): string {
        return "@" + this.getBareMatrixIdFromEmail(email) + ":" + MATRIX_DOMAIN;
    }

    getBareMatrixIdFromEmail(email: string): string {
        return email.replace("@", "_");
    }

    private getAccessToken(): Promise<string> {
        if (!this.loginPromise) {
            const login = this.signIn();
            this.loginPromise = login;
            // A failed sign-in is not kept: the next call tries again.
            login.catch(() => {
                if (this.loginPromise === login) {
                    this.loginPromise = undefined;
                }
            });
        }
        return this.loginPromise;
    }

    private async signIn(): Promise<string> {
        // A token made without a device adds nothing to the admin's device list, however often the game server is redeployed.
        if (MATRIX_ADMIN_TOKEN && !this.adminTokenRefused) {
            return MATRIX_ADMIN_TOKEN;
        }
        const response = await axios
            .post(`${MATRIX_API_URI}_matrix/client/r0/login`, {
                type: "m.login.password",
                user: MATRIX_ADMIN_USER,
                password: MATRIX_ADMIN_PASSWORD,
                device_id: ADMIN_DEVICE_ID,
                initial_device_display_name: "Universe game server",
            })
            .catch((error: unknown) => {
                throw keepSecretsOutOfLogs(error);
            });
        if (response.status === 200 && response.data.errcode === undefined) {
            return response.data.access_token;
        }
        throw new Error("Failed with errcode " + response.data.errcode);
    }

    async setNewMatrixPassword(matrixUserId: string, password: string): Promise<void> {
        const axiosInstance = await this.getAxios();
        const response = await axiosInstance.put(`_synapse/admin/v2/users/${matrixUserId}`, {
            logout_devices: false,
            password,
        });
        if (response.status === 200) {
            return;
        } else {
            throw new Error("Failed with status " + response.status);
        }
    }

    async createRoomForArea(): Promise<string> {
        const options: ICreateRoomOpts = {
            visibility: Visibility.Private,
            initial_state: [
                {
                    type: EventType.RoomHistoryVisibility,
                    content: { history_visibility: "joined" },
                },
            ],
            power_level_content_override: {
                invite: 100,
                ban: 50,
                kick: 50,
            },
        };

        if (this.roomAreaFolderID && MATRIX_DOMAIN) {
            options.initial_state?.push({
                type: EventType.SpaceParent,
                state_key: this.roomAreaFolderID,
                content: {
                    via: [MATRIX_DOMAIN],
                },
            });
        }

        const axiosInstance = await this.getAxios();
        const response = await axiosInstance.post(`_matrix/client/r0/createRoom`, options);
        if (response.status === 200) {
            return await this.AddRoomToFolder(response.data.room_id);
        } else {
            throw new Error("Failed to add room in folder with status " + response.status);
        }
    }

    async kickUserFromRoom(userID: string, roomID: string): Promise<void> {
        const axiosInstance = await this.getAxios();
        const response = await axiosInstance.post(`_matrix/client/r0/rooms/${roomID}/kick`, {
            reason: "kick",
            user_id: userID,
        });
        if (response.status === 200) {
            return;
        } else {
            throw new Error("Failed with status " + response.status);
        }
    }

    async promoteUserToModerator(userID: string, roomID: string): Promise<void> {
        const axiosInstance = await this.getAxios();
        const actualPowerLevelsResponse = await axiosInstance.get(
            `_matrix/client/r0/rooms/${roomID}/state/m.room.power_levels`
        );

        if (actualPowerLevelsResponse.status !== 200) {
            throw new Error("Failed get actual powerLevels " + actualPowerLevelsResponse.status);
        }

        const response = await axiosInstance.put(`_matrix/client/r0/rooms/${roomID}/state/m.room.power_levels`, {
            ...(actualPowerLevelsResponse.data ?? {}),
            users: {
                ...(actualPowerLevelsResponse.data.users ?? {}),
                [userID]: 50,
            },
        });

        if (response.status === 200) {
            return;
        } else {
            throw new Error("Failed with status " + response.status);
        }
    }
    async inviteUserToRoom(userID: string, roomID: string): Promise<void> {
        if (!roomID) {
            console.error("roomID is undefined or null");
            return;
        }
        const axiosInstance = await this.getAxios();
        const response = await axiosInstance.post(`_matrix/client/r0/rooms/${roomID}/invite`, {
            user_id: userID,
        });
        if (response.status === 200) {
            return;
        } else {
            throw new Error("Failed with status " + response.status);
        }
    }

    async changeRoomName(roomID: string, name: string): Promise<void> {
        const axiosInstance = await this.getAxios();
        const response = await axiosInstance.put(`_matrix/client/r0/rooms/${roomID}/state/m.room.name`, {
            name,
        });
        if (response.status === 200) {
            return;
        } else {
            throw new Error("Failed with status " + response.status);
        }
    }

    private async overrideRateLimitForAdminAccount() {
        if (!MATRIX_DOMAIN) {
            // Without the domain the admin id would end in ":undefined" and Synapse would answer 400.
            console.warn("MATRIX_DOMAIN is not set: the chat admin account keeps the default Synapse rate limits");
            return;
        }
        const axiosInstance = await this.getAxios();
        const response = await axiosInstance.post(`_synapse/admin/v1/users/${ADMIN_CHAT_ID}/override_ratelimit`, {
            message_per_second: 0,
            burst_count: 0,
        });
        if (response.status === 200) {
            return;
        } else {
            throw new Error("Failed with status " + response.status);
        }
    }

    private async createChatFolderAreaAndSetID(): Promise<string> {
        try {
            const folderAreaID = await this.getChatFolderAreaID();
            if (folderAreaID) {
                return Promise.resolve(folderAreaID);
            }
        } catch (error) {
            console.info(`Failed to get chat folder area ID, creating one ${error}`);
        }

        const axiosInstance = await this.getAxios();
        const response = await axiosInstance.post(`_matrix/client/r0/createRoom`, {
            visibility: "public",
            room_alias_name: this.roomAreaFolderName,
            name: this.roomAreaFolderName,
            creation_content: {
                type: "m.space",
            },
        });
        if (response.status === 200) {
            return response.data.room_id;
        } else {
            throw new Error("Failed with status " + response.status);
        }
    }

    private async getChatFolderAreaID(): Promise<string | undefined> {
        const axiosInstance = await this.getAxios();
        const response = await axiosInstance.get(
            `_matrix/client/r0/directory/room/%23${this.roomAreaFolderName}:${MATRIX_DOMAIN}`
        );
        if (response.status === 200) {
            return Promise.resolve(response.data.room_id);
        } else {
            return Promise.resolve(undefined);
        }
    }

    async AddRoomToFolder(roomID: string): Promise<string> {
        if (!this.roomAreaFolderID) {
            console.error(new Error(`Failed to add room : ${roomID} to room area folder `));
            return roomID;
        }

        const roomLinkContent = {
            via: [MATRIX_DOMAIN],
        };

        const axiosInstance = await this.getAxios();
        const response = await axiosInstance.put(
            `_matrix/client/r0/rooms/${this.roomAreaFolderID}/state/m.space.child/${roomID}`,
            roomLinkContent
        );
        if (response.status === 200) {
            return roomID;
        } else {
            throw new Error(`Failed to add room : ${roomID} to room area folder `);
        }
    }

    async deleteRoom(roomID: string): Promise<void> {
        await this.kickAllUsersFromRoom(roomID);
        return this.kickUserFromRoom(ADMIN_CHAT_ID, roomID);
    }

    async kickAllUsersFromRoom(roomID: string): Promise<void> {
        const axiosInstance = await this.getAxios();
        const response = await axiosInstance.get(`_matrix/client/r0/rooms/${roomID}/members`);

        if (response.status !== 200) {
            throw new Error(`Failed to fetch members for room: ${roomID}`);
        }

        const kickMembersPromises = response.data.chunk.reduce(
            (acc: Promise<void>[], currentMember: { state_key: string; content: { membership: string } }) => {
                if (currentMember.state_key !== ADMIN_CHAT_ID && currentMember.content.membership !== "join") {
                    acc.push(limit(() => this.kickUserFromRoom(currentMember.state_key, roomID)));
                }
                return acc;
            },
            []
        );
        try {
            await Promise.all(kickMembersPromises);
            return;
        } catch (e) {
            console.error("Failed to kick all user", e);
            return;
        }
    }
}

export const matrixProvider = new MatrixProvider();
