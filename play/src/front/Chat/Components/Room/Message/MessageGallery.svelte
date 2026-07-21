<script lang="ts">
    import type { Readable } from "svelte/store";
    import type { ChatMessageContent } from "../../../Connection/ChatConnection";
    import Lightbox from "./Lightbox.svelte";
    import LL from "../../../../../i18n/i18n-svelte";

    export let content: Readable<ChatMessageContent>;

    let showLightbox = false;
    let lightboxIndex = 0;

    // --- Type detection from URL extension ---
    type MediaType = "image" | "video" | "audio" | "file";

    function inferMediaType(url: string): MediaType {
        const pathPart = url.split("?")[0];
        const ext = pathPart.split(".").pop()?.toLowerCase();
        if (!ext) return "file";
        switch (ext) {
            case "png":
            case "jpg":
            case "jpeg":
            case "gif":
            case "webp":
            case "bmp":
            case "svg":
                return "image";
            case "mp4":
            case "webm":
            case "ogg":
            case "mov":
            case "avi":
            case "mkv":
                return "video";
            case "mp3":
            case "wav":
            case "aac":
            case "flac":
            case "m4a":
            case "wma":
                return "audio";
            default:
                return "file";
        }
    }

    // --- File type icon info ---
    interface FileTypeInfo {
        color: string;
        label: string;
    }

    function getFileTypeInfo(url: string): FileTypeInfo {
        const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
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
            case "mp3":
            case "wav":
            case "aac":
            case "flac":
            case "m4a":
                return { color: "#8E24AA", label: "AUDIO" };
            case "mp4":
            case "webm":
            case "mov":
            case "avi":
            case "mkv":
                return { color: "#3F51B5", label: "VIDEO" };
            case "txt":
            case "md":
                return { color: "#78909C", label: "TXT" };
            default:
                return { color: "#757575", label: "FILE" };
        }
    }

    // --- Extract filename from URL ---
    function getFilename(url: string): string {
        const pathPart = url.split("?")[0];
        const segments = pathPart.split("/");
        const filename = segments[segments.length - 1] || "file";
        // Decode URI-encoded characters
        try {
            return decodeURIComponent(filename);
        } catch {
            return filename;
        }
    }

    // --- Categorize all URLs ---
    interface GalleryItem {
        url: string;
        type: MediaType;
        filename: string;
    }

    let allItems: GalleryItem[] = [];
    $: {
        const next: GalleryItem[] = [];
        const seen = new Set<string>();
        const names = $content.fileNames ?? [];
        let nameIdx = 0;
        const add = (u: string) => {
            if (u) {
                if (!seen.has(u)) {
                    seen.add(u);
                    next.push({ url: u, type: inferMediaType(u), filename: names[nameIdx] ?? getFilename(u) });
                }
                nameIdx++;
            }
        };
        if ($content.url) add($content.url);
        if ($content.urls) for (const u of $content.urls) add(u);
        allItems = next;
    }

    // Items that go in the lightbox: images + videos
    $: lightboxItems = allItems.filter((item) => item.type === "image" || item.type === "video");
    // Audio items for inline player cards
    $: audioItems = allItems.filter((item) => item.type === "audio");
    // Non-audio file items for file cards
    $: docItems = allItems.filter((item) => item.type === "file");

    // Thumbnail URLs for the lightbox strip (images + videos)
    $: lightboxThumbnails = lightboxItems.map((item) => item.url);
    $: currentLightboxItem = lightboxItems[lightboxIndex];

    function openLightbox(index: number) {
        lightboxIndex = index;
        showLightbox = true;
    }
</script>

<div class="gallery-container">
    <!-- IMAGE ZONE: images + videos in a grid -->
    {#if lightboxItems.length === 1}
        <!-- Single image/video: render like MessageImage -->
        <a
            href={lightboxItems[0].url}
            target="_blank"
            class="cursor-pointer relative group block p-1 pb-0"
            on:click|preventDefault={() => openLightbox(0)}
        >
            <div
                class="bg-contrast/50 p-1 rounded absolute top-2 right-2 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all h-fit w-fit"
            >
                <div class="hover:bg-white/10 rounded-sm p-1">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="block"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        stroke-width="1.5"
                        stroke="#ffffff"
                        fill="none"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                        <path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" />
                        <path d="M11 13l9 -9" />
                        <path d="M15 4h5v5" />
                    </svg>
                </div>
            </div>
            {#if lightboxItems[0].type === "video"}
                <div class="relative">
                    <!-- svelte-ignore a11y-media-has-caption -->
                    <video
                        src={lightboxItems[0].url}
                        preload="metadata"
                        class="w-full object-cover max-h-52 rounded"
                        draggable="false"
                    />
                    <div class="absolute inset-0 flex items-center justify-center bg-black/30 rounded">
                        <div class="bg-black/50 rounded-full p-3">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="28"
                                height="28"
                                viewBox="0 0 24 24"
                                fill="#ffffff"
                            >
                                <path d="M8 5v14l11-7z" />
                            </svg>
                        </div>
                    </div>
                </div>
            {:else}
                <img
                    class="w-full object-cover max-h-52 rounded"
                    src={lightboxItems[0].url}
                    alt={$content.body}
                    draggable="false"
                />
            {/if}
        </a>
    {:else if lightboxItems.length === 2}
        <!-- 2 items: side by side -->
        <div class="grid grid-cols-2 gap-0.5 p-1">
            {#each lightboxItems as item, i (item.url)}
                <button
                    class="relative group overflow-hidden rounded cursor-pointer"
                    on:click={() => openLightbox(i)}
                    aria-label="Open media {i + 1}"
                >
                    {#if item.type === "video"}
                        <!-- svelte-ignore a11y-media-has-caption -->
                        <video src={item.url} preload="metadata" class="w-full h-40 object-cover" draggable="false" />
                        <div class="absolute inset-0 flex items-center justify-center bg-black/30">
                            <div class="bg-black/50 rounded-full p-2.5">
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="24"
                                    height="24"
                                    viewBox="0 0 24 24"
                                    fill="#ffffff"
                                >
                                    <path d="M8 5v14l11-7z" />
                                </svg>
                            </div>
                        </div>
                    {:else}
                        <img class="w-full h-40 object-cover" src={item.url} alt={$content.body} draggable="false" />
                    {/if}
                    <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                </button>
            {/each}
        </div>
    {:else if lightboxItems.length === 3}
        <!-- 3 items: one large + two small -->
        <div class="grid grid-cols-2 gap-0.5 p-1" style="grid-template-rows: 1fr 1fr;">
            <button
                class="relative group overflow-hidden rounded cursor-pointer row-span-2"
                on:click={() => openLightbox(0)}
                aria-label="Open media 1"
            >
                {#if lightboxItems[0].type === "video"}
                    <!-- svelte-ignore a11y-media-has-caption -->
                    <video
                        src={lightboxItems[0].url}
                        preload="metadata"
                        class="w-full h-full object-cover"
                        draggable="false"
                    />
                    <div class="absolute inset-0 flex items-center justify-center bg-black/30">
                        <div class="bg-black/50 rounded-full p-3">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="28"
                                height="28"
                                viewBox="0 0 24 24"
                                fill="#ffffff"
                            >
                                <path d="M8 5v14l11-7z" />
                            </svg>
                        </div>
                    </div>
                {:else}
                    <img
                        class="w-full h-full object-cover"
                        src={lightboxItems[0].url}
                        alt={$content.body}
                        draggable="false"
                    />
                {/if}
                <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
            </button>
            {#each lightboxItems.slice(1) as item, i (item.url)}
                <button
                    class="relative group overflow-hidden rounded cursor-pointer"
                    on:click={() => openLightbox(i + 1)}
                    aria-label="Open media {i + 2}"
                >
                    {#if item.type === "video"}
                        <!-- svelte-ignore a11y-media-has-caption -->
                        <video src={item.url} preload="metadata" class="w-full h-full object-cover" draggable="false" />
                        <div class="absolute inset-0 flex items-center justify-center bg-black/30">
                            <div class="bg-black/50 rounded-full p-2">
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="22"
                                    height="22"
                                    viewBox="0 0 24 24"
                                    fill="#ffffff"
                                >
                                    <path d="M8 5v14l11-7z" />
                                </svg>
                            </div>
                        </div>
                    {:else}
                        <img class="w-full h-full object-cover" src={item.url} alt={$content.body} draggable="false" />
                    {/if}
                    <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                </button>
            {/each}
        </div>
    {:else if lightboxItems.length >= 4}
        <!-- 4+ items: responsive grid, cap at 6 visible -->
        <div class="grid grid-cols-3 gap-0.5 p-1">
            {#each lightboxItems.slice(0, 6) as item, i (item.url)}
                <button
                    class="relative group overflow-hidden rounded cursor-pointer"
                    on:click={() => openLightbox(i)}
                    aria-label="Open media {i + 1}"
                >
                    {#if item.type === "video"}
                        <!-- svelte-ignore a11y-media-has-caption -->
                        <video src={item.url} preload="metadata" class="w-full h-32 object-cover" draggable="false" />
                        <div class="absolute inset-0 flex items-center justify-center bg-black/30">
                            <div class="bg-black/50 rounded-full p-2">
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="22"
                                    height="22"
                                    viewBox="0 0 24 24"
                                    fill="#ffffff"
                                >
                                    <path d="M8 5v14l11-7z" />
                                </svg>
                            </div>
                        </div>
                    {:else}
                        <img class="w-full h-32 object-cover" src={item.url} alt={$content.body} draggable="false" />
                    {/if}
                    <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                    {#if lightboxItems.length > 6 && i === 5}
                        <div class="absolute inset-0 flex items-center justify-center bg-black/50">
                            <span class="text-white font-bold text-xl">+{lightboxItems.length - 6}</span>
                        </div>
                    {/if}
                </button>
            {/each}
        </div>
    {/if}

    <!-- FILE ZONE: non-image files as cards -->
    {#if docItems.length > 0 || audioItems.length > 0}
        <div class="px-1 pb-1 space-y-1">
            <!-- Document files -->
            {#each docItems as item (item.url)}
                {@const info = getFileTypeInfo(item.url)}
                <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="flex items-center gap-3 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors group"
                >
                    <!-- File type icon -->
                    <div
                        class="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-white text-[10px] font-bold tracking-wide"
                        style="background: {info.color};"
                    >
                        {info.label}
                    </div>
                    <!-- Filename + open link -->
                    <div class="flex-1 min-w-0">
                        <div class="text-sm text-white/90 truncate">{item.filename}</div>
                        <div class="text-[10px] text-white/40">{$LL.chat.file.clickToOpen()}</div>
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
            {/each}

            <!-- Audio files: inline player cards -->
            {#each audioItems as item (item.url)}
                {@const info = getFileTypeInfo(item.url)}
                <div class="flex items-center gap-3 p-2 rounded-lg bg-white/5">
                    <!-- Audio icon -->
                    <div
                        class="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
                        style="background: {info.color};"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="#ffffff"
                        >
                            <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                            <path
                                d="M21 19a2 2 0 0 1 -2 2h-1v-7h3v5z"
                                fill="none"
                                stroke="#ffffff"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            />
                            <path
                                d="M3 19a2 2 0 0 0 2 2h1v-7h-3v5z"
                                fill="none"
                                stroke="#ffffff"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            />
                        </svg>
                    </div>
                    <!-- Audio player + download -->
                    <div class="flex-1 min-w-0 flex items-center gap-2">
                        <!-- svelte-ignore a11y-media-has-caption -->
                        <audio controls src={item.url} class="flex-1 min-w-0 h-8" style="max-width: 200px;" />
                        <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="flex-shrink-0 opacity-40 hover:opacity-80 transition-opacity"
                            aria-label="Download audio"
                        >
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
                        </a>
                    </div>
                </div>
            {/each}
        </div>
    {/if}

    <!-- Caption/text below gallery -->
    {#if $content.body && $content.body.trim()}
        <div class="px-2 py-1 text-sm text-white/90">{$content.body}</div>
    {/if}
</div>

<Lightbox
    src={currentLightboxItem?.url}
    alt={$content.body}
    show={showLightbox}
    thumbnails={lightboxThumbnails}
    currentIndex={lightboxIndex}
    isVideo={currentLightboxItem?.type === "video"}
    hasPrev={lightboxItems.length > 1}
    hasNext={lightboxItems.length > 1}
    on:close={() => (showLightbox = false)}
    on:prev={() => (lightboxIndex = (lightboxIndex - 1 + lightboxItems.length) % lightboxItems.length)}
    on:next={() => (lightboxIndex = (lightboxIndex + 1) % lightboxItems.length)}
    on:jump={(e) => (lightboxIndex = e.detail)}
/>
