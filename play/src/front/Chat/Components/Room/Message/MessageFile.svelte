<script lang="ts">
    import type { Readable } from "svelte/store";
    import type { ChatMessageContent } from "../../../Connection/ChatConnection";

    export let content: Readable<ChatMessageContent>;

    // --- File type icon info (copied from MessageGallery.svelte) ---
    interface FileTypeInfo {
        color: string;
        label: string;
    }

    function getFileTypeInfo(url: string | undefined): FileTypeInfo {
        const ext = url?.split("?")[0].split(".").pop()?.toLowerCase();
        switch (ext) {
            case "pdf":
                return { color: "#E53935", label: "PDF" };
            case "doc":
            case "docx":
                return { color: "#1976D2", label: "DOC" };
            case "xls":
            case "xlsx":
            case "csv":
                return { color: "#43A047", label: "XLS" };
            case "ppt":
            case "pptx":
                return { color: "#FB8C00", label: "PPT" };
            case "zip":
            case "rar":
            case "7z":
            case "tar":
            case "gz":
                return { color: "#FDD835", label: "ZIP" };
            default:
                return { color: "#757575", label: "FILE" };
        }
    }

    // --- Extract filename from URL as fallback ---
    function getFilenameFromUrl(url: string | undefined): string {
        if (!url) return "file";
        const pathPart = url.split("?")[0];
        const segments = pathPart.split("/");
        const filename = segments[segments.length - 1] || "file";
        try {
            return decodeURIComponent(filename);
        } catch {
            return filename;
        }
    }

    $: info = getFileTypeInfo($content.url);
    $: displayName = $content.filename ?? getFilenameFromUrl($content.url);
    $: hasCaption = $content.body && $content.body.trim();
</script>

<a
    href={$content.url}
    target="_blank"
    rel="noopener noreferrer"
    download
    class="flex items-center gap-3 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors group"
>
    <!-- File type icon badge -->
    <div
        class="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-white text-[10px] font-bold tracking-wide"
        style="background: {info.color};"
    >
        {info.label}
    </div>
    <!-- Filename + open link -->
    <div class="flex-1 min-w-0">
        <div class="text-sm text-white/90 truncate">{displayName}</div>
        <div class="text-[10px] text-white/40">Click to open</div>
    </div>
    <!-- Download/open icon -->
    <div class="flex-shrink-0 opacity-40 group-hover:opacity-80 transition-opacity">
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            stroke="#ffffff"
            fill="none"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path d="M21 15v4a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-4" />
            <path d="M7 10l5 5l5 -5" />
            <path d="M12 15l0 -12" />
        </svg>
    </div>
</a>

<!-- Caption/text below file card -->
{#if hasCaption}
    <div class="px-2 py-1 text-sm text-white/90">{$content.body}</div>
{/if}
