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
import type { PartnerPlace } from "./PartnerPlace";
import { findInUniverse, partnerActions, resolvePartnerPlace } from "./PartnerPlace";

type UsersByRoom = Map<string | undefined, { roomName: string | undefined; users: ChatUser[] }>;

/** The other person of a direct chat, and what you can do with them right now. */
export interface DirectPartner {
    chatId: string | undefined;
    /** Their avatar in Universe, when they have one right now. */
    user: ChatUser | undefined;
    place: PartnerPlace;
    actions: { walkTo: boolean; locate: boolean };
    isBot: boolean;
    isBlocked: boolean;
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
            // The current map changes when the scene reloads.
            gameSceneStore,
        ],
        ([member, map, chatPresence, { participants: inBubble, kind }, ignored, scene]) => {
            const chatId = member?.id;
            const currentRoomUrl = scene?.roomUrl;
            const found = chatId ? findInUniverse(map, chatId, currentRoomUrl) : undefined;
            const user = found?.user;
            return {
                chatId,
                found,
                chatPresence,
                sameMap: user?.playUri !== undefined && user.playUri === currentRoomUrl,
                talkingWithYou:
                    kind === "bubble" &&
                    user?.spaceUserId !== undefined &&
                    inBubble.some((participant) => participant.id === user.spaceUserId),
                isBlocked: chatId !== undefined && ignored.includes(chatId),
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
            place,
            actions: partnerActions(place, user?.uuid !== undefined),
            isBot: user?.isBot === true,
            isBlocked: state.isBlocked,
        };
    });
}
