import type { Subscription } from "rxjs";
import { get } from "svelte/store";
import { availabilityStatusToJSON } from "@workadventure/messages";
import type { RoomConnection } from "../../Connection/RoomConnection";
import { localUserStore } from "../../Connection/LocalUserStore";
import type { FollowPerson } from "../../Stores/FollowStore";
import { followRoleStore, followStateStore, followUsersStore } from "../../Stores/FollowStore";
import { iframeListener } from "../../Api/IframeListener";
import type { RemotePlayersRepository } from "./RemotePlayersRepository";

export class FollowManager {
    private subscriptions: Subscription[] = [];

    constructor(private connection: RoomConnection, private remotePlayersRepository: RemotePlayersRepository) {
        this.subscriptions.push(
            this.connection.followRequestMessageStream.subscribe((followRequestMessage) => {
                if (localUserStore.getIgnoreFollowRequests()) {
                    return;
                }
                // Already leading or following: the request is left unanswered. A new question replaces an old one.
                const state = get(followStateStore);
                if (state !== "off" && !(state === "requesting" && get(followRoleStore) === "follower")) {
                    return;
                }
                followUsersStore.addFollowRequest(this.person(followRequestMessage.leader));
                if (followRequestMessage.forceFollow) {
                    // If forceFollow, we emit directly back the followConfirmationMessage
                    followUsersStore.follow();
                    this.connection.emitFollowConfirmation(followRequestMessage.leader);
                }
            })
        );

        this.subscriptions.push(
            this.connection.followConfirmationMessageStream.subscribe((followConfirmationMessage) => {
                followUsersStore.addFollower(this.person(followConfirmationMessage.follower));
                const remoteFollower = this.remotePlayersRepository
                    .getPlayers()
                    .get(followConfirmationMessage.follower);
                if (remoteFollower) {
                    iframeListener.sendFollowedEvent({
                        playerId: followConfirmationMessage.follower,
                        name: remoteFollower.name,
                        position: remoteFollower.position,
                        availabilityStatus: availabilityStatusToJSON(remoteFollower.availabilityStatus),
                        outlineColor: remoteFollower.outlineColor,
                        userUuid: remoteFollower.userUuid,
                        variables: remoteFollower.variables,
                    });
                } else {
                    console.warn(
                        "Received followConfirmationMessage for unknown player",
                        followConfirmationMessage.follower
                    );
                }
            })
        );

        this.subscriptions.push(
            this.connection.followAbortMessageStream.subscribe((followAbortMessage) => {
                if (get(followRoleStore) === "follower") {
                    followUsersStore.endFromLeader(followAbortMessage.leader, followAbortMessage.follower);
                    return;
                }
                if (followAbortMessage.follower === 0 || get(followStateStore) === "off") {
                    // A request we were not following, or one already over here.
                    return;
                }
                const wasFollowing = get(followUsersStore).includes(followAbortMessage.follower);
                followUsersStore.removeFollower(followAbortMessage.follower);
                if (!wasFollowing) {
                    // Someone said no: they never followed, so scripts hear nothing.
                    return;
                }
                const remoteFollower = this.remotePlayersRepository.getPlayers().get(followAbortMessage.follower);
                if (remoteFollower) {
                    iframeListener.sendUnfollowedEvent({
                        playerId: followAbortMessage.follower,
                        name: remoteFollower.name,
                        position: remoteFollower.position,
                        availabilityStatus: availabilityStatusToJSON(remoteFollower.availabilityStatus),
                        outlineColor: remoteFollower.outlineColor,
                        userUuid: remoteFollower.userUuid,
                        variables: remoteFollower.variables,
                    });
                } else {
                    console.warn("Received followAbortMessage for unknown player", followAbortMessage.follower);
                }
            })
        );

        iframeListener.registerAnswerer("followMe", () => {
            this.connection?.emitFollowRequest(true);
        });

        iframeListener.registerAnswerer("stopLeading", () => {
            this.connection?.emitFollowAbort();
            followUsersStore.stopFollowing();
        });
    }

    private person(userId: number): FollowPerson {
        return { userId, name: this.remotePlayersRepository.getPlayers().get(userId)?.name ?? "" };
    }

    public close() {
        if (get(followStateStore) !== "off") {
            this.connection?.emitFollowAbort();
        }
        this.subscriptions.forEach((subscription) => subscription.unsubscribe());
        iframeListener.unregisterAnswerer("followMe");
        iframeListener.unregisterAnswerer("stopLeading");
        followUsersStore.stopFollowing();
    }
}
