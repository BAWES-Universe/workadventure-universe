import { derived, get, type Readable } from "svelte/store";
import type { EmojiClickEvent } from "emoji-picker-element/shared";
import type { ChatMessage } from "../../../Connection/ChatConnection";
import { selectedChatMessageToEdit, selectedChatMessageToReply } from "../../../Stores/ChatStore";
import { notificationPlayingStore } from "../../../../Stores/NotificationStore";
import LL from "../../../../../i18n/i18n-svelte";
import { showFloatingUi } from "../../../../Utils/svelte-floatingui-show";
import LazyEmote from "../../../../Components/EmoteMenu/LazyEmote.svelte";
import { getCopyableText, getSaveableFiles, type SaveableFile } from "./messageActions";
import { saveFiles } from "./saveFiles";

export interface AvailableActions {
    react: boolean;
    reply: boolean;
    copyText: string | undefined;
    files: SaveableFile[];
    edit: boolean;
    delete: boolean;
}

/** The actions a message offers, the same in the hover bar, the press-and-hold menu and the right-click menu. */
export function availableActions(message: ChatMessage): Readable<AvailableActions> {
    return derived(
        [message.content, message.canReact, message.canReply, message.canDelete],
        ([$content, $canReact, $canReply, $canDelete]) => ({
            react: $canReact,
            reply: $canReply,
            copyText: getCopyableText(message.type, $content),
            files: getSaveableFiles(message.type, $content),
            edit: message.isMyMessage && message.type === "text",
            delete: $canDelete,
        })
    );
}

export function hasAnyAction(actions: AvailableActions): boolean {
    return (
        actions.react ||
        actions.reply ||
        actions.copyText !== undefined ||
        actions.files.length > 0 ||
        actions.edit ||
        actions.delete
    );
}

export function reactTo(message: ChatMessage, emoji: string): void {
    // An emoji already on the message toggles like its chip: picking your own reaction again takes it back.
    const existing = message.reactions.get(emoji);
    if (existing) {
        existing.react();
        return;
    }
    message.addReaction(emoji).catch((error) => console.error(error));
}

export function replyTo(message: ChatMessage): void {
    selectedChatMessageToEdit.set(null);
    selectedChatMessageToReply.set(message);
    // Straight to typing the reply, like other chat apps.
    document.querySelector<HTMLElement>("[data-testid=messageInput]")?.focus();
}

export function editMessage(message: ChatMessage): void {
    selectedChatMessageToReply.set(null);
    selectedChatMessageToEdit.set(message);
}

export function deleteMessage(message: ChatMessage): void {
    message.remove();
}

export async function copyText(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        notificationPlayingStore.playNotification(get(LL).chat.messageActions.textCopied());
    } catch (error) {
        console.warn("Could not copy the message text", error);
    }
}

export async function saveMessageFiles(files: SaveableFile[]): Promise<void> {
    const result = await saveFiles(files);
    if (result === "failed") {
        notificationPlayingStore.playNotification(get(LL).chat.messageActions.saveFailed());
    }
}

/** Opens the full emoji picker next to a message; picking an emoji reacts with it. Returns a function that closes it. */
export function openReactionPicker(message: ChatMessage, anchor: Element, onClosed?: () => void): () => void {
    let destroy: (() => void) | undefined = undefined;
    const close = () => {
        if (!destroy) return;
        destroy();
        destroy = undefined;
        onClosed?.();
    };
    destroy = showFloatingUi(
        anchor,
        LazyEmote,
        {
            onEmojiClick: (event: EmojiClickEvent) => {
                // Custom emoji have no unicode: there is nothing to react with.
                const emoji = event.detail.unicode;
                if (emoji) reactTo(message, emoji);
                close();
            },
            onClose: close,
        },
        { placement: "top-end" },
        12,
        true
    );
    return close;
}
