<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import type { Unsubscriber } from "svelte/store";
    import type { ChatMessage } from "../../../Connection/ChatConnection";
    import { IconPlayerPlayFilled } from "@wa-icons";

    /**
     * One image or video in a grid of what the chat shared. Its file is only fetched once it comes into view (the
     * message's content starts the download when listened to), and let go when the grid goes.
     */
    export let message: ChatMessage;
    export let label: string;
    /** Who sent it, on a small chip, or nothing. */
    export let sender: string | undefined = undefined;

    let box: HTMLElement;
    let url: string | undefined;
    let unsubscribe: Unsubscriber | undefined;
    let observer: IntersectionObserver | undefined;

    function load() {
        if (unsubscribe) return;
        unsubscribe = message.content.subscribe((content) => (url = content.url));
    }

    onMount(() => {
        if (typeof IntersectionObserver === "undefined") {
            load();
            return;
        }
        observer = new IntersectionObserver(
            (entries) => {
                if (!entries.some((entry) => entry.isIntersecting)) return;
                load();
                observer?.disconnect();
            },
            { rootMargin: "200px" }
        );
        observer.observe(box);
    });

    onDestroy(() => {
        observer?.disconnect();
        unsubscribe?.();
    });

    $: isVideo = message.type === "video";
</script>

<button
    type="button"
    class="media-thumb relative m-0 block aspect-square w-full overflow-hidden rounded-lg bg-white/10 p-0"
    aria-label={label}
    title={label}
    bind:this={box}
    on:click
    data-testid="sharedMediaThumb"
>
    {#if url && isVideo}
        <!-- A still of the video's first moments, without its controls. -->
        <video class="h-full w-full object-cover" src="{url}#t=0.1" preload="metadata" muted playsinline />
    {:else if url}
        <img class="h-full w-full object-cover" src={url} alt="" draggable="false" />
    {:else}
        <span class="block h-full w-full animate-pulse bg-white/5" />
    {/if}
    {#if isVideo}
        <span class="absolute inset-0 grid place-items-center text-white" aria-hidden="true">
            <span class="grid h-8 w-8 place-items-center rounded-full bg-black/55"
                ><IconPlayerPlayFilled font-size="16" /></span
            >
        </span>
    {/if}
    {#if sender}
        <span
            class="absolute bottom-1 start-1 max-w-[calc(100%-0.5rem)] truncate rounded-full bg-black/60 px-1.5 text-[10px] font-semibold leading-4 text-white"
            >{sender}</span
        >
    {/if}
</button>

<style>
    .media-thumb:focus-visible {
        outline: 2px solid rgba(196, 181, 253, 0.9);
        outline-offset: 2px;
    }
</style>
