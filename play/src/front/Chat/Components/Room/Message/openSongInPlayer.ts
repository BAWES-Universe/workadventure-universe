import { derived, get } from "svelte/store";
import { fileKindOf } from "../../../../FileViewer/fileKinds";
import { openChatFileInViewer, type ChatFileToOpen } from "../../../../FileViewer/openFileViewer";
import { selectedRoomStore } from "../../../Stores/SelectRoomStore";
import { sharedItemsStore } from "../Details/SharedItemsStore";

/**
 * Opens an audio file from its chat card in the window's player (game #1642), listed with the chat's other audio
 * files as its Files show them, and carrying on from `at` seconds. `key` is the message's own key among the Files.
 */
export function openSongInPlayer(
    song: Pick<ChatFileToOpen, "url" | "name" | "senderName" | "sentByMe"> & { key: string | undefined; at: number }
): void {
    const room = get(selectedRoomStore);
    const songs = room
        ? derived(sharedItemsStore(room), ($shared) =>
              $shared.files.filter((file) => fileKindOf(file.name) === "audio")
          )
        : undefined;
    openChatFileInViewer({
        url: song.url,
        name: song.name,
        senderName: song.senderName,
        sentByMe: song.sentByMe,
        inChat: songs && song.key ? { tracks: songs, key: song.key } : undefined,
        startPlaying: true,
        startAt: song.at > 0 ? song.at : undefined,
    });
}
