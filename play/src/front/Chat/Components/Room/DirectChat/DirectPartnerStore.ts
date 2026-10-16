import type { Readable } from "svelte/store";
import { derived } from "svelte/store";
import type { AvailabilityStatus } from "@workadventure/messages";
import type {
    ChatPresence,
    ChatRoomMember,
    ChatRoomMembershipManagement,
    ChatUser,
} from "../../../Connection/ChatConnection";
import type {
    ProximityChatParticipant,
    ProximityChatRoom,
    ProximitySpaceKind,
} from "../../../Connection/Proximity/ProximityChatRoom";
import { gameManager } from "../../../../Phaser/Game/GameManager";
import { gameSceneStore } from "../../../../Stores/GameSceneStore";
import { localUserStore } from "../../../../Connection/LocalUserStore";
import { friendsStore } from "../../../Stores/FriendsStore";
import type { PartnerPlace } from "./PartnerPlace";
import { gameBlockedPeople } from "./gameBlockedPeople";
import { findAccountUuid, findInUniverse, partnerActions, resolvePartnerPlace } from "./PartnerPlace";

type UsersByRoom = Map<string | undefined, { roomName: string | undefined; users: ChatUser[] }>;

/** The other person of a direct chat, and what you can do with them right now. */
export interface DirectPartner {
    chatId: string | undefined;
    /** Their avatar in Universe, when they have one right now. */
    user: ChatUser | undefined;
    /** Their account id: from their avatar, else the member list or your friends. Unknown when they are not in a world with you, not a member you can see and not a friend. */
    uuid: string | undefined;
    place: PartnerPlace;
    actions: { walkTo: boolean; locate: boolean };
    isBot: boolean;
    /** Blocked in chat. */
    isBlocked: boolean;
    /** Blocked in the game, from the meeting's Moderation menu (or by a block in chat). */
    isGameBlocked: boolean;
}

const NO_USERS: UsersByRoom = new Map();

/**
 * Everyone in Universe by map, from the current scene (empty while there is none). Follows the scene, so a chat opened
 * before the map has loaded, or kept open across a map change, picks up the new list.
 */
const usersByRoom: Readable<UsersByRoom> = derived<typeof gameSceneStore, UsersByRoom>(
    gameSceneStore,
    (scene, set) => {
        set(NO_USERS);
        if (!scene) return;
        let unsubscribe: (() => void) | undefined;
        let stopped = false;
        scene.userProviderMerger
            .then((merger) => {
                if (!stopped) unsubscribe = merger.usersByRoomStore.subscribe(set);
            })
            .catch((error) => console.error("Failed to get the users by room", error));
        return () => {
            stopped = true;
            unsubscribe?.();
        };
    },
    NO_USERS
);

/** Who is in your bubble or meeting right now, from the current scene. */
const proximity: Readable<{ participants: ProximityChatParticipant[]; kind: ProximitySpaceKind }> = derived<
    typeof gameSceneStore,
    { participants: ProximityChatParticipant[]; kind: ProximitySpaceKind }
>(
    gameSceneStore,
    (scene, set) => {
        let room: ProximityChatRoom | undefined;
        try {
            room = scene?.proximityChatRoom;
        } catch {
            // No proximity chat yet: nobody is talking with you.
        }
        if (!room) {
            set({ participants: [], kind: "none" });
            return;
        }
        return derived([room.participants, room.spaceKind], ([participants, kind]) => ({
            participants,
            kind,
        })).subscribe(set);
    },
    { participants: [], kind: "none" }
);

export function directPartnerStore(room: ChatRoomMembershipManagement): Readable<DirectPartner> {
    const myChatId = localUserStore.getChatId();
    const chatConnection = gameManager.chatConnection;
    const partnerMember = derived(room.members, (members: ChatRoomMember[]) =>
        members.find((member) => member.id !== myChatId)
    );
    const presence = derived<Readable<ChatRoomMember | undefined>, ChatPresence>(
        partnerMember,
        (member, set) => (member ? chatConnection.userPresence(member.id).subscribe(set) : set("offline")),
        "offline"
    );
    const seen = derived(
        [
            partnerMember,
            usersByRoom,
            presence,
            proximity,
            chatConnection.ignoredUsers,
            friendsStore,
            // The current map changes when the scene reloads.
            gameSceneStore,
            gameBlockedPeople,
        ],
        ([member, map, chatPresence, { participants: inBubble, kind }, ignored, friends, scene, gameBlocked]) => {
            const chatId = member?.id;
            const currentRoomUrl = scene?.roomUrl;
            const found = chatId ? findInUniverse(map, chatId, currentRoomUrl) : undefined;
            const user = found?.user;
            const uuid =
                user?.uuid ??
                (chatId
                    ? findAccountUuid(map, friends.status === "signedOut" ? [] : friends.list?.friends ?? [], chatId)
                    : undefined);
            return {
                chatId,
                found,
                uuid,
                chatPresence,
                sameMap: user?.playUri !== undefined && user.playUri === currentRoomUrl,
                talkingWithYou:
                    kind === "bubble" &&
                    user?.spaceUserId !== undefined &&
                    inBubble.some((participant) => participant.id === user.spaceUserId),
                isBlocked: chatId !== undefined && ignored.includes(chatId),
                isGameBlocked: uuid !== undefined && gameBlocked.has(uuid),
            };
        }
    );
    const availability = derived<typeof seen, AvailabilityStatus | undefined>(
        seen,
        ({ found }, set) => (found ? found.user.availabilityStatus.subscribe(set) : set(undefined)),
        undefined
    );

    return derived([seen, availability], ([state, status]) => {
        const user = state.found?.user;
        const place = resolvePartnerPlace({
            inGame: user !== undefined,
            sameMap: state.sameMap,
            roomName: state.found?.roomName,
            availability: status,
            talkingWithYou: state.talkingWithYou,
            chatPresence: state.chatPresence,
        });
        return {
            chatId: state.chatId,
            user,
            uuid: state.uuid,
            place,
            actions: partnerActions(place, user?.uuid !== undefined),
            isBot: user?.isBot === true,
            isBlocked: state.isBlocked,
            isGameBlocked: state.isGameBlocked,
        };
    });
}
