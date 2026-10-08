import * as Sentry from "@sentry/svelte";
import { get } from "svelte/store";
import type CancelablePromise from "cancelable-promise";
import type { PositionMessage, PositionMessage_Direction, SayMessage } from "@workadventure/messages";
import type { WokaMenuAction } from "../../Stores/WokaMenuStore";
import { wokaMenuStore } from "../../Stores/WokaMenuStore";
import { Character } from "../Entity/Character";
import type { GameScene } from "../Game/GameScene";
import type { ActivatableInterface } from "../Game/ActivatableInterface";
import { LL } from "../../../i18n/i18n-svelte";
import { blackListManager } from "../../WebRtc/BlackListManager";
import { showReportScreenStore } from "../../Stores/ShowReportScreenStore";
import { iframeListener } from "../../Api/IframeListener";
import banIcon from "../../Components/images/ban-icon.svg";
import { openDirectChatRoom } from "../../Chat/Utils";
import { userIsConnected } from "../../Stores/MenuStore";
import { localUserStore } from "../../Connection/LocalUserStore";
import { analyticsClient } from "../../Administration/AnalyticsClient";
import { canOpenOrbit, openOrbitProfile } from "../../external-modules/admin-api/index";
import { friendsEnabledStore, relationshipsStore } from "../../Chat/Stores/FriendsStore";
import { invitesEnabledStore, ringStore } from "../../Chat/Stores/RingStore";
import { friendMenuAction } from "../../Chat/Components/UserList/FriendMenuAction";
import { IconMessage, IconUserCircle, IconUsersPlus, IconWalk } from "@wa-icons";

export enum RemotePlayerEvent {
    Clicked = "Clicked",
}

/**
 * Class representing the sprite of a remote player (a player that plays on another computer)
 */
export class RemotePlayer extends Character implements ActivatableInterface {
    public readonly userId: number;
    public readonly userUuid: string;
    public readonly activationRadius: number;

    private visitCardUrl: string | null;

    constructor(
        userId: number,
        userUuid: string,
        Scene: GameScene,
        x: number,
        y: number,
        name: string,
        texturesPromise: CancelablePromise<string[]>,
        direction: PositionMessage_Direction,
        moving: boolean,
        visitCardUrl: string | null,
        companionTexturePromise: CancelablePromise<string>,
        activationRadius?: number,
        private chatID: string | undefined = undefined,
        sayMessage?: SayMessage
    ) {
        super(Scene, x, y, texturesPromise, name, direction, moving, 1, true, companionTexturePromise);

        //set data
        this.userId = userId;
        this.userUuid = userUuid;
        this.visitCardUrl = visitCardUrl;
        this.setClickable(this.getDefaultWokaMenuActions().length > 0);
        this.activationRadius = activationRadius ?? 96;

        if (sayMessage) {
            this.say(sayMessage.message, sayMessage.type);
        }

        this.bindEventHandlers();
    }

    public updatePosition(position: PositionMessage): void {
        this.playAnimation(position.direction, position.moving);
        this.setX(position.x);
        this.setY(position.y);

        this.setDepth(position.y); //this is to make sure the perspective (player models closer the bottom of the screen will appear in front of models nearer the top of the screen).

        if (this.companion) {
            this.companion.setTarget(position.x, position.y, position.direction);
        }
    }

    public getVisitCardUrl(): string | null {
        return this.visitCardUrl;
    }

    public registerWokaMenuAction(action: WokaMenuAction): void {
        wokaMenuStore.addAction({
            ...action,
            priority: action.priority ?? 0,
            callback: () => {
                action.callback();
                wokaMenuStore.removeRemotePlayer(this.userUuid, this.userId);
            },
        });
    }

    public unregisterWokaMenuAction(actionName: string) {
        wokaMenuStore.removeAction(actionName);
    }

    public activate(): void {
        this.toggleActionsMenu();
    }

    /**
     * Shows this avatar's card, and leaves it as it is when it already shows (Locate, from the People tab or a
     * search): unlike a click on the avatar, it never closes the card.
     */
    public showCard(): void {
        if (this.isCardShown()) return;
        this.openActionsMenu();
    }

    public deactivate(): void {
        wokaMenuStore.removeRemotePlayer(this.userUuid, this.userId);
    }

    public destroy(): void {
        wokaMenuStore.removeRemotePlayer(this.userUuid, this.userId);
        super.destroy();
    }

    public isActivatable(): boolean {
        return this.isClickable();
    }

    /** This avatar's card is the one showing (not a card of another tab or device of the same person). */
    private isCardShown(): boolean {
        const card = get(wokaMenuStore);
        return card !== undefined && !card.isSelf && card.userId === this.userId && card.userUuid === this.userUuid;
    }

    private toggleActionsMenu(): void {
        // Close the woka menu if it is already open for this avatar
        if (this.isCardShown()) {
            wokaMenuStore.removeRemotePlayer(this.userUuid, this.userId);
            return;
        }
        this.openActionsMenu();
    }

    private openActionsMenu(): void {
        // Track the open woka menu action
        analyticsClient.openWokaMenu();

        // Initialize the woka menu
        wokaMenuStore.initialize(this.playerName, this.userId, this.userUuid, this.visitCardUrl ?? undefined);

        // Add the default actions to the woka menu
        for (const action of this.getDefaultWokaMenuActions()) {
            wokaMenuStore.addAction(action);
        }

        // Send the remote player clicked event to the iframe listener
        const userFound = this.scene.getRemotePlayersRepository().getPlayers().get(this.userId);
        if (!userFound) {
            console.error("Undefined clicked player!");
            return;
        }

        // Send the remote player clicked event to the iframe listener
        iframeListener.sendRemotePlayerClickedEvent(userFound);
    }

    private getDefaultWokaMenuActions(): WokaMenuAction[] {
        const actions: WokaMenuAction[] = [];
        // Under the card's "more" (⋯) button: it opens the Moderate screen, which says what blocking does and asks
        // before doing it (Block, or Report to the room's admins).
        actions.push({
            actionName: blackListManager.isBlackListed(this.userUuid)
                ? get(LL).report.block.unblock()
                : get(LL).report.block.blockOrReport(),
            protected: true,
            priority: -1,
            overflow: true,
            style: "text-red-500",
            testId: "wokamenu-block-user-button",
            callback: () => {
                // Track the report user action
                analyticsClient.reportUser();

                showReportScreenStore.set({ userUuid: this.userUuid, userName: this.playerName });
            },
            actionIcon: banIcon,
        });
        if (!blackListManager.isBlackListed(this.userUuid)) {
            actions.push({
                // Walks you to them: the same words as the People tab's button.
                actionName: get(LL).chat.userList.walkTo(),
                protected: false,
                priority: 2,
                style: "bg-white/10 hover:bg-white/30",
                callback: () => {
                    // Track the talk to user action
                    analyticsClient.goToUser();

                    if (this.scene.connection != undefined)
                        this.scene.connection.emitAskPosition(this.userUuid, this.scene.roomUrl);
                },
                actionIcon: IconWalk,
            });
        }
        // Only a signed-in player gets a chat id, so this shows when you are both signed in: the same button,
        // words and flow as the People tab's Message, between Walk to and Block. Never on another of your own tabs
        // or devices: there is no chat with yourself.
        const chatID = this.getChatID();
        const isMyOtherSession =
            chatID === localUserStore.getChatId() || this.userUuid === localUserStore.getLocalUser()?.uuid;
        // Invite: anyone on the map you haven't blocked, guests too, between Walk to and Add friend. The server says
        // where it reaches; "can't invite from here" shows if it doesn't.
        if (get(invitesEnabledStore) && !isMyOtherSession && !blackListManager.isBlackListed(this.userUuid)) {
            actions.push({
                actionName: get(LL).chat.friends.ring.ring(),
                protected: false,
                priority: 1.8,
                style: "bg-white/10 hover:bg-white/30",
                testId: "wokamenu-invite-button",
                callback: () => {
                    ringStore.ring(this.userUuid, this.playerName).catch((e) => console.error(e));
                },
                actionIcon: IconUsersPlus,
            });
        }
        if (chatID !== undefined && get(userIsConnected) && !isMyOtherSession) {
            actions.push({
                actionName: get(LL).chat.userList.message(),
                protected: false,
                priority: 1,
                style: "bg-white/10 hover:bg-white/30",
                testId: "wokamenu-message-button",
                callback: () => {
                    // Track the opened chat action
                    analyticsClient.openedChat();

                    openDirectChatRoom(chatID).catch((error) => {
                        console.error("Error opening direct chat room:", error);
                        Sentry.captureException(error, {
                            extra: {
                                userId: this.userUuid,
                                chatId: chatID,
                                playUri: this.scene.roomUrl,
                                username: this.playerName,
                            },
                        });
                    });
                },
                actionIcon: IconMessage,
            });
        }
        // Add friend beside Message when you are both signed in; once asked or friends, the follow-up (cancel,
        // remove) waits under "more", and accepting their request stays beside Message.
        if (chatID !== undefined && get(friendsEnabledStore) && !isMyOtherSession) {
            const relationship = get(relationshipsStore).get(this.userUuid) ?? "none";
            const friendAction = friendMenuAction(relationship, this.userUuid, this.playerName, get(LL));
            if (friendAction) {
                const inMain = relationship === "none" || relationship === "request_received";
                actions.push({
                    actionName: friendAction.label,
                    protected: false,
                    priority: inMain ? 1.5 : -0.5,
                    overflow: !inMain,
                    style: friendAction.danger ? "text-red-500" : "bg-white/10 hover:bg-white/30",
                    testId: "wokamenu-friend-button",
                    callback: friendAction.act,
                    actionIcon: friendAction.icon,
                });
            }
        }
        // Their profile in Orbit, when you are both signed in (only signed-in players have a chat id): after Message.
        if (chatID !== undefined && canOpenOrbit()) {
            actions.push({
                actionName: get(LL).chat.userList.viewProfile(),
                protected: false,
                priority: 0,
                style: "bg-white/10 hover:bg-white/30",
                testId: "wokamenu-view-profile-button",
                callback: () => {
                    openOrbitProfile(this.userUuid);
                },
                actionIcon: IconUserCircle,
            });
        }

        return actions;
    }

    /**
     * Their chat id. A player's chat connects after they arrive on the map, so the id they joined with is often
     * empty; the world space (the People tab's source) gets it once their chat is up.
     */
    private getChatID(): string | undefined {
        if (this.chatID) return this.chatID;
        const users = get(this.scene.allUsersInWorldStore);
        if (!users) return undefined;
        for (const user of users.values()) {
            if (user.uuid === this.userUuid && user.chatID) return user.chatID;
        }
        return undefined;
    }

    private bindEventHandlers(): void {
        this.on(Phaser.Input.Events.POINTER_DOWN, (event: Phaser.Input.Pointer) => {
            if (event.downElement.nodeName === "CANVAS" && event.leftButtonDown()) {
                this.emit(RemotePlayerEvent.Clicked);
            }
        });
    }
}
