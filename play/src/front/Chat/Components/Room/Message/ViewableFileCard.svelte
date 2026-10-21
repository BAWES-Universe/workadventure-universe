<script lang="ts">
    import { getContext, onMount } from "svelte";
    import LL from "../../../../../i18n/i18n-svelte";
    import { saveMessageFiles } from "../MessageActions/availableActions";
    import { badgeOfKind, formatFileSize, fileKindOf } from "../../../../FileViewer/fileKinds";
    import {
        openChatFileInNewTab,
        openChatFileInViewer,
        openFileViewerKeys,
    } from "../../../../FileViewer/openFileViewer";
    import { MESSAGE_SENDER_CONTEXT, type MessageSenderInfo } from "./messageSenderContext";
    import { IconDownload } from "@wa-icons";

    /** The blob: URL the chat fetched the file into. */
    export let url: string;
    export let name: string;

    const sender = getContext<MessageSenderInfo | undefined>(MESSAGE_SENDER_CONTEXT);

    let size: number | undefined;

    $: kind = fileKindOf(name);
    $: badge = kind ? badgeOfKind(kind, name) : { color: "#757575", label: "FILE", kindName: "File" };
    $: isOpen = $openFileViewerKeys.has(`chat:${url}`);
    $: sub = size === undefined ? badge.kindName : `${badge.kindName} · ${formatFileSize(size)}`;

    onMount(() => {
        // The size comes from the copy chat already holds in memory: nothing is downloaded again.
        if (!url.startsWith("blob:")) return;
        fetch(url)
            .then((response) => response.blob())
            .then((blob) => (size = blob.size))
            .catch(() => undefined);
    });

    function open(event: MouseEvent) {
        if (event.button !== 0) return;
        event.preventDefault();
        // Ctrl or Cmd click is the way to open it elsewhere: the browser's own viewer, in a new tab.
        if (event.ctrlKey || event.metaKey) {
            openChatFileInNewTab({ url, name });
            return;
        }
        openChatFileInViewer({ url, name, senderName: sender?.name, sentByMe: sender?.isMine });
    }

    function save() {
        saveMessageFiles([{ url, name }]).catch((error) => console.error(error));
    }
</script>

<div class="file-card flex items-center gap-1 p-2 rounded-lg bg-white/5" class:open={isOpen} data-testid="fileCard">
    <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        download={name}
        class="flex flex-1 min-w-0 items-center gap-3 text-inherit no-underline"
        aria-label={$LL.chat.fileViewer.openFile({ name })}
        on:click={open}
    >
        <div
            class="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-white text-[10px] font-bold tracking-wide"
            style="background: {badge.color};"
        >
            {badge.label}
        </div>
        <div class="flex-1 min-w-0">
            <div class="text-sm text-white/90 truncate">{name}</div>
            <div class="text-[11px] text-white/45 mt-0.5">{sub}</div>
        </div>
    </a>
    <button
        type="button"
        class="download-button"
        title={$LL.chat.fileViewer.download()}
        aria-label={$LL.chat.fileViewer.downloadFile({ name })}
        on:click={save}
        data-testid="fileCardDownload"
    >
        <IconDownload font-size="18" />
    </button>
</div>

<style>
    /* The file that is open in the viewer: soft violet, as a picked card. */
    .file-card.open {
        outline: 2px solid #b9a6ff;
        outline-offset: -2px;
        background: rgba(185, 166, 255, 0.12);
    }

    .download-button {
        flex: none;
        width: 40px;
        height: 40px;
        padding: 0;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(255, 255, 255, 0.04);
        color: #fff;
        display: grid;
        place-items: center;
        cursor: pointer;
    }

    .download-button:hover {
        background: rgba(255, 255, 255, 0.1);
    }

    @media (pointer: coarse) {
        .download-button {
            width: 44px;
            height: 44px;
        }
    }
</style>
