<script lang="ts">
    import type { ChatMessage } from "../../../Connection/ChatConnection";
    import LL from "../../../../../i18n/i18n-svelte";
    import { summarizeForReply } from "./messageActions";
    import { IconFile, IconX } from "@wa-icons";

    /** The box above the message field while replying: who and what the reply quotes, with a thumbnail for photos. */
    export let message: ChatMessage;
    export let onClose: () => void;

    const content = message.content;

    $: summary = summarizeForReply(message.type, $content);
    $: name = message.isMyMessage ? $LL.chat.messageActions.you() : message.sender?.username ?? "";
    $: description =
        summary.kind === "text"
            ? summary.text
            : summary.kind === "photos"
            ? summary.caption ??
              (summary.count > 1
                  ? $LL.chat.messageActions.photos({ count: summary.count })
                  : $LL.chat.messageActions.photo())
            : summary.kind === "files"
            ? summary.caption ??
              (summary.count > 1 ? $LL.chat.messageActions.files({ count: summary.count }) : summary.name)
            : summary.caption ??
              (summary.kind === "video" ? $LL.chat.messageActions.video() : $LL.chat.messageActions.audio());
</script>

<div class="reply-preview" data-testid="replyPreview">
    {#if summary.kind === "photos" && summary.thumbnail}
        <img class="thumb" src={summary.thumbnail} alt="" draggable="false" />
    {:else if summary.kind === "files"}
        <span class="thumb file" aria-hidden="true"><IconFile font-size={18} /></span>
    {/if}
    <div class="text">
        <span class="who">{$LL.chat.messageActions.replyingTo({ name })}</span>
        <span class="what">{description}</span>
    </div>
    <button
        class="close"
        on:click={onClose}
        aria-label={$LL.chat.messageActions.close()}
        data-testid="cancelReplyButton"
    >
        <IconX font-size={18} />
    </button>
</div>

<style lang="scss">
    .reply-preview {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 8px 6px 8px 10px;
        border-radius: 14px;
        background: rgb(20 18 30 / 0.97);
        border: 1px solid rgb(167 139 250 / 0.32);
        box-shadow: 0 8px 24px rgb(0 0 0 / 0.4);
    }

    .thumb {
        width: 36px;
        height: 36px;
        flex: none;
        border-radius: 8px;
        object-fit: cover;
    }

    .thumb.file {
        display: grid;
        place-items: center;
        background: rgb(255 255 255 / 0.08);
        color: rgb(255 255 255 / 0.7);
    }

    .text {
        display: flex;
        flex-direction: column;
        min-width: 0;
        flex: 1;
        line-height: 1.3;
    }

    .who {
        font-size: 12px;
        font-weight: 700;
        color: #a78bfa;
    }

    .what {
        font-size: 13px;
        color: rgb(255 255 255 / 0.7);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .close {
        width: 32px;
        height: 32px;
        flex: none;
        display: grid;
        place-items: center;
        border-radius: 9999px;
        color: rgb(255 255 255 / 0.7);
    }

    .close:hover,
    .close:focus-visible {
        background: rgb(255 255 255 / 0.1);
        color: #fff;
        outline: none;
    }
</style>
