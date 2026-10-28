import type { TranslationFunctions } from "../../../../../i18n/i18n-types";
import type { ChatMessage, ChatMessageContent } from "../../../Connection/ChatConnection";
import { getCopyableText, getMediaCaption } from "../MessageActions/messageActions";

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
            return message.sharedFile?.name || LL.chat.messageActions.audio();
        default:
            return getCopyableText(message.type, content) ?? content.body;
    }
}
