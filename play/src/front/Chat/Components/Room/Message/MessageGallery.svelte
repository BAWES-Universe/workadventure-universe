<script lang="ts">
    import type { Readable } from "svelte/store";
    import type { ChatMessageContent } from "../../../Connection/ChatConnection";
    import Lightbox from "./Lightbox.svelte";

    export let content: Readable<ChatMessageContent>;

    let showLightbox = false;
    let lightboxIndex = 0;

    // Combine primary url and gallery urls into a single array
    const allUrls: string[] = [];
    $: {
        allUrls.length = 0;
        if ($content.url) allUrls.push($content.url);
        if ($content.urls) {
            for (const u of $content.urls) {
                if (u && !allUrls.includes(u)) allUrls.push(u);
            }
        }
    }

    function openLightbox(index: number) {
        lightboxIndex = index;
        showLightbox = true;
    }
</script>

<div class="gallery-container">
    {#if allUrls.length === 1}
        <!-- Single image: render like MessageImage -->
        <a
            href={allUrls[0]}
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
            <img class="w-full object-cover max-h-52 rounded" src={allUrls[0]} alt={$content.body} draggable="false" />
        </a>
    {:else if allUrls.length === 2}
        <!-- 2 images: side by side -->
        <div class="grid grid-cols-2 gap-0.5 p-1">
            {#each allUrls as url, i (url)}
                <button
                    class="relative group overflow-hidden rounded cursor-pointer"
                    on:click={() => openLightbox(i)}
                    aria-label="Open image {i + 1}"
                >
                    <img class="w-full h-40 object-cover" src={url} alt={$content.body} draggable="false" />
                    <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                </button>
            {/each}
        </div>
    {:else if allUrls.length === 3}
        <!-- 3 images: one large + two small -->
        <div class="grid grid-cols-2 gap-0.5 p-1" style="grid-template-rows: 1fr 1fr;">
            <button
                class="relative group overflow-hidden rounded cursor-pointer row-span-2"
                on:click={() => openLightbox(0)}
                aria-label="Open image 1"
            >
                <img class="w-full h-full object-cover" src={allUrls[0]} alt={$content.body} draggable="false" />
                <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
            </button>
            {#each allUrls.slice(1) as url, i (url)}
                <button
                    class="relative group overflow-hidden rounded cursor-pointer"
                    on:click={() => openLightbox(i + 1)}
                    aria-label="Open image {i + 2}"
                >
                    <img class="w-full h-full object-cover" src={url} alt={$content.body} draggable="false" />
                    <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                </button>
            {/each}
        </div>
    {:else}
        <!-- 4+ images: responsive grid, cap at 6 visible -->
        <div class="grid grid-cols-3 gap-0.5 p-1">
            {#each allUrls.slice(0, 6) as url, i (url)}
                <button
                    class="relative group overflow-hidden rounded cursor-pointer {allUrls.length > 6 && i === 5
                        ? 'brightness-50'
                        : ''}"
                    on:click={() => openLightbox(i)}
                    aria-label="Open image {i + 1}"
                >
                    <img class="w-full h-32 object-cover" src={url} alt={$content.body} draggable="false" />
                    <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                    {#if allUrls.length > 6 && i === 5}
                        <div class="absolute inset-0 flex items-center justify-center text-white font-bold text-lg">
                            +{allUrls.length - 6}
                        </div>
                    {/if}
                </button>
            {/each}
        </div>
    {/if}

    <!-- Caption/text below gallery -->
    {#if $content.body && $content.body.trim()}
        <div class="px-2 py-1 text-sm text-white/90">{$content.body}</div>
    {/if}
</div>

<Lightbox
    src={allUrls[lightboxIndex]}
    alt={$content.body}
    show={showLightbox}
    on:close={() => (showLightbox = false)}
    on:prev={() => (lightboxIndex = (lightboxIndex - 1 + allUrls.length) % allUrls.length)}
    on:next={() => (lightboxIndex = (lightboxIndex + 1) % allUrls.length)}
    hasPrev={allUrls.length > 1}
    hasNext={allUrls.length > 1}
/>
