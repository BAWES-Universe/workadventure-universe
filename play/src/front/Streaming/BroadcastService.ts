import debug from "debug";
import { slugify } from "@workadventure/shared-utils/src/Jitsi/slugify";
import { FilterType } from "@workadventure/messages";
import { get } from "svelte/store";
import type { Subscription } from "rxjs";
import type { SpaceInterface } from "../Space/SpaceInterface";
import type { SpaceRegistryInterface } from "../Space/SpaceRegistry/SpaceRegistryInterface";
import { notificationPlayingStore } from "../Stores/NotificationStore";
import LL from "../../i18n/i18n-svelte";
import { gameManager } from "../Phaser/Game/GameManager";

const broadcastServiceLogger = debug("BroadcastService");

export class BroadcastService {
    private broadcastSpaces: SpaceInterface[] = [];
    private unsubscribes: Subscription[] = [];

    constructor(private spaceRegistry: SpaceRegistryInterface) {}

    /**
     * Join a broadcast space
     * @param spaceName The name of the space to join
     * @returns The broadcast space
     */
    public async joinSpace(spaceName: string, abortSignal: AbortSignal): Promise<SpaceInterface> {
        const spaceNameSlugify = slugify(spaceName);

        const space = await this.spaceRegistry.joinSpace(
            spaceNameSlugify,
            FilterType.LIVE_STREAMING_USERS,
            ["screenSharing", "cameraState", "microphoneState", "megaphoneState"],
            abortSignal
        );

        this.unsubscribes.push(
            space.observeUserJoined.subscribe((user) => {
                if (user.megaphoneState) {
                    notificationPlayingStore.playNotification(get(LL).notification.announcement(), "megaphone");
                    gameManager.getCurrentGameScene().playSound("audio-megaphone");
                }
            })
        );

        this.broadcastSpaces.push(space);

        broadcastServiceLogger("joinSpace", spaceNameSlugify);

        return space;
    }

    /**
     * Leave a broadcast space
     * @param spaceName The name of the space to leave
     */
    public async leaveSpace(spaceName: string) {
        const spaceNameSlugify = slugify(spaceName);
        const space = this.broadcastSpaces.find((space) => space.getName() === spaceNameSlugify);

        if (!space) {
            return;
        }
        // Taken off the list before the registry is asked, so a destroy() during that wait doesn't leave it twice.
        this.broadcastSpaces = this.broadcastSpaces.filter((candidate) => candidate !== space);
        await this.spaceRegistry.leaveSpace(space);
        broadcastServiceLogger("leaveSpace", spaceNameSlugify);
    }

    /**
     * Destroy the broadcast service
     */
    public async destroy(): Promise<void> {
        this.unsubscribes.forEach((unsubscribe) => unsubscribe.unsubscribe());
        const spaces = this.broadcastSpaces;
        this.broadcastSpaces = [];
        await Promise.all(spaces.map((space) => this.spaceRegistry.leaveSpace(space)));
    }
}
