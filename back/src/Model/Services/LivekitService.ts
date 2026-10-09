import crypto from "crypto";
import type { SpaceUser } from "@workadventure/messages";
import type { CreateOptions, EgressInfo } from "livekit-server-sdk";
import {
    RoomServiceClient,
    AccessToken,
    TrackSource,
    EgressClient,
    EncodedFileOutput,
    S3Upload,
    EncodedFileType,
} from "livekit-server-sdk";
import * as Sentry from "@sentry/node";
import Debug from "debug";

const debug = Debug("LivekitService");

const PUBLISH_SOURCES = [
    TrackSource.CAMERA,
    TrackSource.MICROPHONE,
    TrackSource.SCREEN_SHARE,
    TrackSource.SCREEN_SHARE_AUDIO,
];

const defaultRoomServiceClient = (livekitHost: string, livekitApiKey: string, livekitApiSecret: string) =>
    new RoomServiceClient(livekitHost, livekitApiKey, livekitApiSecret);
const defaultEgressClient = (livekitHost: string, livekitApiKey: string, livekitApiSecret: string) =>
    new EgressClient(livekitHost, livekitApiKey, livekitApiSecret);
export class LiveKitService {
    private roomServiceClient: RoomServiceClient;
    private egressClient: EgressClient;
    constructor(
        private livekitHost: string,
        private livekitApiKey: string,
        private livekitApiSecret: string,
        private livekitFrontendUrl: string,
        createRoomServiceClient: (
            livekitHost: string,
            livekitApiKey: string,
            livekitApiSecret: string
        ) => RoomServiceClient = defaultRoomServiceClient,
        createEgressClient: (
            livekitHost: string,
            livekitApiKey: string,
            livekitApiSecret: string
        ) => EgressClient = defaultEgressClient
    ) {
        if (!this.livekitHost || !this.livekitApiKey || !this.livekitApiSecret) {
            debug("Livekit host, api key or secret is not set");
            throw new Error("Livekit host, api key or secret is not set");
        }
        this.roomServiceClient = createRoomServiceClient(this.livekitHost, this.livekitApiKey, this.livekitApiSecret);
        this.egressClient = createEgressClient(this.livekitHost, this.livekitApiKey, this.livekitApiSecret);
    }

    private currentRecordingInformation: EgressInfo | null = null;

    async createRoom(roomName: string): Promise<void> {
        // First check if the room already exists
        const rooms = await this.roomServiceClient.listRooms([roomName]);
        if (rooms && rooms.length > 0) {
            return;
        }

        const hashedRoomName =
            roomName.length > 250
                ? crypto.createHash("sha256").update(roomName).digest("hex").substring(0, 250)
                : roomName;
        // Room doesn't exist, create it
        const createOptions: CreateOptions = {
            name: hashedRoomName,
        };

        await this.roomServiceClient.createRoom(createOptions);
    }

    /**
     * @param canPublish Whether this person may send camera, microphone or screen. Only the people streaming in the
     * space may; everybody else receives. The media server enforces it, so a browser that ignores the app's rules
     * still cannot publish.
     */
    async generateToken(roomName: string, user: SpaceUser, canPublish: boolean): Promise<string> {
        const hashedRoomName = this.getHashedRoomName(roomName);

        const token = new AccessToken(this.livekitApiKey, this.livekitApiSecret, {
            identity: this.getParticipantIdentity(user.spaceUserId),
            name: user.name,
            metadata: JSON.stringify({
                userId: user.spaceUserId,
                uuid: user.uuid,
            }),
        });

        token.addGrant({
            room: hashedRoomName,
            canPublish,
            canSubscribe: true,
            roomJoin: true,
            canPublishSources: canPublish ? PUBLISH_SOURCES : [],
        });
        return token.toJwt();
    }

    private getHashedRoomName(roomName: string): string {
        return roomName.length > 250
            ? crypto.createHash("sha256").update(roomName).digest("hex").substring(0, 250)
            : roomName;
    }

    async deleteRoom(roomName: string): Promise<void> {
        try {
            await this.roomServiceClient.deleteRoom(this.getHashedRoomName(roomName));
            // if(this.currentRecordingInformation) {
            //     this.stopRecording();
            // }
        } catch (error) {
            console.error(`Error deleting room ${roomName}:`, error);
            Sentry.captureException(error);
        }
    }

    private getParticipantIdentity(spaceUserId: string): string {
        return spaceUserId;
    }

    /**
     * Lets a person already in the media room start or stop sending, without a new token. When they stop, the media
     * server ends the tracks they were sending. Returns false when they are not in the media room (yet).
     */
    async setParticipantCanPublish(roomName: string, spaceUserId: string, canPublish: boolean): Promise<boolean> {
        const hashedRoomName = this.getHashedRoomName(roomName);
        const identity = this.getParticipantIdentity(spaceUserId);
        try {
            const participants = await this.roomServiceClient.listParticipants(hashedRoomName);
            if (!participants.some((participant) => participant.identity === identity)) {
                return false;
            }
            await this.roomServiceClient.updateParticipant(hashedRoomName, identity, undefined, {
                canPublish,
                canSubscribe: true,
                canPublishSources: canPublish ? PUBLISH_SOURCES : [],
            });
            return true;
        } catch (error) {
            console.error(
                `LivekitService.setParticipantCanPublish: Error updating ${spaceUserId} in room ${roomName}:`,
                error
            );
            Sentry.captureException(error);
            return false;
        }
    }

    /**
     * Removes a person from the media room. The identity is the space user id, the one their token was made with (not
     * their display name, which is neither unique nor what the media server knows them by).
     */
    async removeParticipant(roomName: string, spaceUserId: string): Promise<void> {
        try {
            const rooms = await this.roomServiceClient.listRooms([this.getHashedRoomName(roomName)]);

            if (rooms && rooms.length > 0) {
                const participants = await this.roomServiceClient.listParticipants(this.getHashedRoomName(roomName));
                const participantExists = participants.some(
                    (p) => p.identity === this.getParticipantIdentity(spaceUserId)
                );

                if (!participantExists) {
                    return;
                }
            } else {
                console.warn(`LivekitService.removeParticipant: Room ${roomName} not found`);
                return;
            }
            await this.roomServiceClient.removeParticipant(
                this.getHashedRoomName(roomName),
                this.getParticipantIdentity(spaceUserId)
            );
        } catch (error) {
            console.error(
                `LivekitService.removeParticipant: Error removing participant ${spaceUserId} from room ${roomName}:`,
                error
            );
            Sentry.captureException(error);
        }
    }

    getLivekitFrontendUrl(): string {
        if (!this.livekitFrontendUrl) {
            throw new Error("Livekit frontend URL is not set");
        }
        return this.livekitFrontendUrl;
    }

    async startRecording(roomName: string, layout = "grid"): Promise<void> {
        try {
            const endpoint = "http://minio-livekit:9000";
            const accessKey = "minio-access-key";
            const secret = "minio-secret-access-key";
            const region = "eu-west-1";
            const bucket = "livekit-recording";
            const filepath = `out/test-${new Date().toISOString().slice(0, 19)}`;

            const output = new EncodedFileOutput({
                fileType: EncodedFileType.MP4,
                filepath,
                output: {
                    case: "s3",
                    value: new S3Upload({
                        endpoint,
                        accessKey,
                        region,
                        secret,
                        bucket,
                        forcePathStyle: true,
                    }),
                },
                disableManifest: true,
            });

            this.currentRecordingInformation = await this.egressClient.startRoomCompositeEgress(
                this.getHashedRoomName(roomName),
                {
                    file: output,
                },
                {
                    layout,
                }
            );

            // Stop recording after 60 seconds
            // setTimeout(async () => {
            //     try {
            //          await this.stopRecording();
            //     } catch (error) {
            //         console.error('Failed to auto-stop recording after 10 seconds:', error);
            //         Sentry.captureException(error);
            //     }
            // }, 60000);
        } catch (error) {
            console.error("Failed to start recording:", error);
            Sentry.captureException(error);
            throw new Error("Failed to start recording", { cause: error });
        }
    }

    async stopRecording(): Promise<void> {
        if (!this.currentRecordingInformation) {
            console.warn("No recording to stop");
            return;
        }
        await this.egressClient.stopEgress(this.currentRecordingInformation.egressId);
        this.currentRecordingInformation = null;
    }
}
