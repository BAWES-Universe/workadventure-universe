<script lang="ts">
    import { onDestroy } from "svelte";
    import type { Readable, Unsubscriber } from "svelte/store";
    import LL, { locale } from "../../../../../i18n/i18n-svelte";
    import type { ChatMessage } from "../../../Connection/ChatConnection";
    import { badgeOfKind, chatFileOpensInViewer, fileKindOf, formatFileSize } from "../../../../FileViewer/fileKinds";
    import { openChatFileInViewer, openFileViewerKeys } from "../../../../FileViewer/openFileViewer";
    import { saveMessageFiles } from "../MessageActions/availableActions";
    import { audioFileTitle } from "../Message/audioFileTitle";
    import { sentLabel, type SharedItem } from "./SharedItems";
    import { sharedSender } from "./sharedSender";

    /**
     * A file the chat shared: its badge, name, kind, size, who sent it and when. A tap opens it beside the map, in the
     * same viewer as its card in the chat; a file the viewer can't read is saved instead. Nothing is downloaded before.
     */
    export let message: ChatMessage;
    /** Shared in a proximity chat (#1615). */
    export let nearby = false;
    export let name: string;
    export let size: number | undefined;
    /** For one file of a gallery: its own link, as the message's link is the first file's. */
    export let src: string | undefined = undefined;
    /** The chat's songs and this file's key among its Files: a song opened from here lists the others. */
    export let songs: Readable<SharedItem[]> | undefined = undefined;
    export let itemKey: string | undefined = undefined;

    let url: string | undefined = src;
    let unsubscribe: Unsubscriber | undefined;
    let waiting = false;
    let waitTimeout: ReturnType<typeof setTimeout> | undefined;

    // A fetch that never brings the file gives up, so the next tap asks again.
    const FILE_WAIT_MS = 15000;

    $: kind = fileKindOf(name);
    // A song shows the chat player's title: a random name says nothing, and the line under it says who sent it.
    $: shownName = kind === "audio" ? audioFileTitle(name) ?? $LL.chat.audioFile.untitled() : name;
    $: badge = kind ? badgeOfKind(kind, name) : { color: "#757575", label: "FILE", kindName: "File" };
    $: sender = sharedSender(message, $LL.chat.details.you());
    $: details = [
        badge.kindName,
        size !== undefined ? formatFileSize(size) : undefined,
        sender,
        sentLabel(message.date, $locale),
    ]
        .filter(Boolean)
        .join(" · ");
    $: isOpen = url !== undefined && $openFileViewerKeys.has(`chat:${url}`);

    function openWith(fileUrl: string) {
        if (chatFileOpensInViewer(name) || kind === "audio") {
            openChatFileInViewer({
                url: fileUrl,
                name,
                senderName: sender,
                sentByMe: message.isMyMessage,
                inChat: songs && itemKey ? { tracks: songs, key: itemKey } : undefined,
            });
        } else {
            saveMessageFiles([{ url: fileUrl, name }]).catch((error) => console.error(error));
        }
    }

    // The message fetches its file once listened to (with the sign-in token), and keeps it while this row is here.
    function open() {
        if (url) {
            openWith(url);
            return;
        }
        if (waiting) return;
        waiting = true;
        waitTimeout = setTimeout(stopWaiting, FILE_WAIT_MS);
        unsubscribe ??= message.content.subscribe((content) => {
            url = content.url;
            if (url && waiting) {
                waiting = false;
                clearTimeout(waitTimeout);
                openWith(url);
            }
        });
    }

    function stopWaiting() {
        waiting = false;
        if (url) return;
        unsubscribe?.();
        unsubscribe = undefined;
    }

    onDestroy(() => {
        clearTimeout(waitTimeout);
        unsubscribe?.();
    });
</script>

<button
    type="button"
    class="shared-row m-0 flex min-h-[44px] w-full items-center gap-3 rounded-xl p-2 text-start"
    class:open={isOpen}
    aria-busy={waiting}
    on:click={open}
    data-testid="sharedFile"
>
    <span
        class="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[10px] font-bold tracking-wide text-white"
        style="background: {badge.color};"
    >
        {badge.label}
    </span>
    <span class="flex min-w-0 flex-1 flex-col">
        <span class="truncate text-sm text-white/90">{shownName}</span>
        <span class="truncate text-[11px] text-white/45">{details}</span>
    </span>
    {#if nearby}
        <span class="where-tag" data-testid="sharedNearbyTag">{$LL.chat.session.proximityTag()}</span>
    {/if}
</button>

<style>
    .where-tag {
        display: inline-flex;
        align-items: center;
        flex-shrink: 0;
        height: 1.125rem;
        padding: 0 0.4rem;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.02em;
        color: #d8ccff;
        background: rgb(134 41 252 / 0.22);
        border: 1px solid rgb(167 139 250 / 0.3);
    }
    .shared-row {
        font-family: inherit;
        background: transparent;
        border: 1px solid transparent;
    }
    .shared-row:hover {
        background: rgba(255, 255, 255, 0.06);
    }
    .shared-row.open {
        background: rgba(134, 41, 252, 0.16);
        border-color: rgba(167, 139, 250, 0.45);
    }
    .shared-row:focus-visible {
        outline: 2px solid rgba(196, 181, 253, 0.9);
        outline-offset: -2px;
    }
    .shared-row[aria-busy="true"] {
        opacity: 0.7;
    }
</style>
