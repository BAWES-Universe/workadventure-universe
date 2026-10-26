import type { MatrixClient, MatrixEvent, RoomMember } from "matrix-js-sdk";
import { RoomMemberEvent } from "matrix-js-sdk";
import type { Writable } from "svelte/store";
import { get, writable } from "svelte/store";
import type { ChatRoomMember, ChatRoomMembership, memberTypingInformation } from "../ChatConnection";
import { ChatPermissionLevel, TYPING_STOP_GRACE_MS } from "../ChatConnection";
import type { PictureStore } from "../../../Stores/PictureStore";
import { changingMatrixAvatarStore } from "./MatrixMedia";

export class MatrixChatRoomMember implements ChatRoomMember {
    private handleRoomMemberMembership = this.onRoomMemberMembership.bind(this);
    private handleRoomMemberName = this.onRoomMemberName.bind(this);
    private handleRoomMemberPowerLevel = this.onRoomMemberPowerLevel.bind(this);
    private handleRoomMemberTyping = this.onRoomMemberTyping.bind(this);
    readonly id: string;
    readonly name: Writable<string>;
    readonly membership: Writable<ChatRoomMembership>;
    readonly permissionLevel: Writable<ChatPermissionLevel>;
    readonly isTypingInformation: Writable<{ id: string; name: string | null; pictureStore: PictureStore } | null> =
        writable(null);
    /** Their chat account picture (the Woka their game saved there), as the chat shows it. */
    readonly pictureStore: PictureStore;
    private typingGraceTimer: ReturnType<typeof setTimeout> | undefined;
    private readonly pictureMxc: Writable<string | undefined>;

    constructor(private roomMember: RoomMember, client: MatrixClient) {
        this.id = roomMember.userId;
        this.name = writable(this.roomMember.name);
        this.membership = writable(this.roomMember.membership);
        this.permissionLevel = writable(MatrixChatRoomMember.getPermissionLevel(this.roomMember.powerLevelNorm));
        this.pictureMxc = writable(this.roomMember.getMxcAvatarUrl());
        this.pictureStore = changingMatrixAvatarStore(client, this.pictureMxc, 24);
        this.startHandlingChatRoomMemberEvents();
    }

    private startHandlingChatRoomMemberEvents(): void {
        this.roomMember.on(RoomMemberEvent.Membership, this.handleRoomMemberMembership);
        this.roomMember.on(RoomMemberEvent.PowerLevel, this.handleRoomMemberPowerLevel);
        this.roomMember.on(RoomMemberEvent.Name, this.handleRoomMemberName);
        this.roomMember.on(RoomMemberEvent.Typing, this.handleRoomMemberTyping);
    }

    private onRoomMemberMembership(ev: MatrixEvent, member: RoomMember) {
        this.membership.set(member.membership ?? "unknown");
    }
    private onRoomMemberName(ev: MatrixEvent, member: RoomMember) {
        this.name.set(member.name);
    }
    private onRoomMemberPowerLevel(ev: MatrixEvent, member: RoomMember) {
        this.permissionLevel.set(MatrixChatRoomMember.getPermissionLevel(member.powerLevelNorm));
    }
    private onRoomMemberTyping(ev: MatrixEvent, member: RoomMember) {
        this.clearTypingGrace();
        if (member.typing) {
            const memberInformation: memberTypingInformation = {
                id: this.id,
                name: get(this.name),
                pictureStore: this.pictureStore,
            };
            this.isTypingInformation.set(memberInformation);
            return;
        }
        if (get(this.isTypingInformation) === null) return;
        // The dots stay a moment after a "stopped", in case typing starts again right away.
        this.typingGraceTimer = setTimeout(() => {
            this.typingGraceTimer = undefined;
            this.isTypingInformation.set(null);
        }, TYPING_STOP_GRACE_MS);
    }

    /** Their message arrived: they are no longer typing it, and the dots go at once. */
    stoppedTyping(): void {
        this.clearTypingGrace();
        this.isTypingInformation.set(null);
    }

    private clearTypingGrace(): void {
        if (this.typingGraceTimer === undefined) return;
        clearTimeout(this.typingGraceTimer);
        this.typingGraceTimer = undefined;
    }

    static getPermissionLevel(powerLevel: number): ChatPermissionLevel {
        return powerLevel >= 100
            ? ChatPermissionLevel.ADMIN
            : powerLevel >= 50
            ? ChatPermissionLevel.MODERATOR
            : ChatPermissionLevel.USER;
    }
    static getPowerLevel(chatPermissionLevel: ChatPermissionLevel): number {
        switch (chatPermissionLevel) {
            case ChatPermissionLevel.USER:
                return 0;
            case ChatPermissionLevel.MODERATOR:
                return 50;
            case ChatPermissionLevel.ADMIN:
                return 100;
            default:
                throw new Error(`${chatPermissionLevel} is not handle`);
        }
    }

    /** Their member event changed: they may have a new picture. */
    refreshPicture(): void {
        const mxc = this.roomMember.getMxcAvatarUrl();
        if (mxc !== get(this.pictureMxc)) this.pictureMxc.set(mxc);
    }

    destroy() {
        this.roomMember.off(RoomMemberEvent.Membership, this.handleRoomMemberMembership);
        this.roomMember.off(RoomMemberEvent.PowerLevel, this.handleRoomMemberPowerLevel);
        this.roomMember.off(RoomMemberEvent.Name, this.handleRoomMemberName);
        this.roomMember.off(RoomMemberEvent.Typing, this.handleRoomMemberTyping);
        this.clearTypingGrace();
    }
}
