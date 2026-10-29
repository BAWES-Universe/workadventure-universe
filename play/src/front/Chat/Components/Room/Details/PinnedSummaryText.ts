import type { TranslationFunctions } from "../../../../../i18n/i18n-types";
import type { ChatMessage, ChatMessageContent } from "../../../Connection/ChatConnection";
import { getCopyableText, getMediaCaption } from "../MessageActions/messageActions";
import { audioFileTitle } from "../Message/audioFileTitle";

/** What a pinned message says in one line: its text, or what it carries (a photo, a video, a file's name). */
export function pinnedText(message: ChatMessage, content: ChatMessageContent, LL: TranslationFunctions): string {
    switch (message.type) {
        case "image":
        case "gallery":
            return getMediaCaption(content) ?? LL.chat.messageActions.photo();
        case "video":
            return getMediaCaption(content) ?? LL.chat.messageActions.video();
        case "file":
            return message.sharedFile?.name || content.filename || content.body;
        case "audio":
            // A song says the chat player's title: a random name says nothing. A voice note keeps its own.
            if (message.sharedFile?.voice) return message.sharedFile.name || LL.chat.messageActions.audio();
            return audioFileTitle(message.sharedFile?.name) ?? LL.chat.messageActions.audio();
        default:
            return getCopyableText(message.type, content) ?? content.body;
    }
}
