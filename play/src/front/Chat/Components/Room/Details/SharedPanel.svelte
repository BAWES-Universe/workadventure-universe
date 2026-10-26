<script lang="ts">
    import { getContext, hasContext, onDestroy, onMount } from "svelte";
    import { readable } from "svelte/store";
    import type { Readable, Unsubscriber } from "svelte/store";
    import LL, { locale } from "../../../../../i18n/i18n-svelte";
    import type { ChatMessage, ChatRoom } from "../../../Connection/ChatConnection";
    import { SHARED_TABS, openSharedItemsStore, type SharedTab } from "../../../Stores/ChatDetailsStore";
    import { NAME_BY_CHAT_ID_CONTEXT, personName } from "../../../Stores/ChatUserWokaStore";
    import Lightbox from "../Message/Lightbox.svelte";
    import SwipeTabs from "./SwipeTabs.svelte";
    import MediaThumb from "./MediaThumb.svelte";
    import LinkRow from "./LinkRow.svelte";
    import FileRow from "./FileRow.svelte";
    import { sharedItemsStore } from "./SharedItemsStore";
    import { sharedSections, type SharedSection } from "./SharedItems";
    import { sharedSender } from "./sharedSender";
    import { IconChevronLeft, IconChevronRight, IconLoader } from "@wa-icons";

    /**
     * Everything the chat shared, over its details: images and videos, links and files, newest first under their
     * week or month, in tabs that swipe. Back returns to the details.
     */
    export let room: ChatRoom;
    export let tab: SharedTab;
    /** In a direct chat, the other person: the chat is named after the name they go by now. */
    export let partnerChatId: string | undefined = undefined;

    const direction = document.documentElement.getAttribute("dir") || "ltr";
    const shared = sharedItemsStore(room);
    const hasPreviousMessage = room.hasPreviousMessage;
    const now = new Date();
    const roomName = room.name;
    const nameByChatId: Readable<Map<string, string>> = hasContext(NAME_BY_CHAT_ID_CONTEXT)
        ? getContext(NAME_BY_CHAT_ID_CONTEXT)
        : readable(new Map<string, string>());
    $: chatName = personName($nameByChatId, partnerChatId, $roomName);

    $: tabs = [
        { id: "media" as const, label: $LL.chat.details.tabs.media(), count: $shared.media.length },
        { id: "links" as const, label: $LL.chat.details.tabs.links(), count: $shared.links.length },
        { id: "files" as const, label: $LL.chat.details.tabs.files(), count: $shared.files.length },
    ];

    function sectionLabel(section: SharedSection): string {
        switch (section.kind) {
            case "thisWeek":
                return $LL.chat.details.sections.thisWeek();
            case "lastWeek":
                return $LL.chat.details.sections.lastWeek();
            case "thisMonth":
                return $LL.chat.details.sections.thisMonth();
            case "month":
                return new Date(section.year, section.month, 1).toLocaleDateString($locale, {
                    month: "long",
                    ...(section.year !== now.getFullYear() ? { year: "numeric" } : {}),
                });
            case "undated":
                return $LL.chat.details.sections.undated();
        }
    }

    function back() {
        openSharedItemsStore.set(undefined);
    }

    // The tabs speak in plain strings: back to one of ours.
    function tabOf(id: string): SharedTab {
        return SHARED_TABS.find((known) => known === id) ?? "media";
    }

    function changeTab(next: string) {
        openSharedItemsStore.set({ roomId: room.id, tab: tabOf(next) });
    }

    // Only the messages loaded so far are known: the page reads a little further back on its own, then on request.
    const AUTOMATIC_LOADS = 3;
    let loading = false;
    let destroyed = false;

    async function lookFurther(times = 1) {
        if (loading) return;
        loading = true;
        try {
            for (let load = 0; load < times && $hasPreviousMessage && !destroyed; load++) {
                // eslint-disable-next-line no-await-in-loop
                await room.loadMorePreviousMessages();
            }
        } catch (error) {
            console.error("Failed to load earlier messages", error);
        } finally {
            loading = false;
        }
    }

    onMount(() => {
        lookFurther(AUTOMATIC_LOADS).catch((error) => console.error(error));
    });

    // An image or video opens big, with the others before and after it, as a gallery in the chat does.
    // Kept by key, so an image arriving or going while it is open doesn't swap the one on screen.
    let lightboxKey: string | undefined;
    let lightboxUrl: string | undefined;
    let lightboxUnsubscribe: Unsubscriber | undefined;
    $: lightboxIndex = lightboxKey === undefined ? -1 : $shared.media.findIndex((item) => item.key === lightboxKey);
    $: lightboxItem = lightboxIndex >= 0 ? $shared.media[lightboxIndex] : undefined;
    $: watchLightbox(lightboxItem?.message, lightboxItem?.src);

    function watchLightbox(message: ChatMessage | undefined, src: string | undefined) {
        lightboxUnsubscribe?.();
        lightboxUnsubscribe = undefined;
        lightboxUrl = src;
        if (message && src === undefined) {
            lightboxUnsubscribe = message.content.subscribe((content) => (lightboxUrl = content.url));
        }
    }

    function step(delta: number) {
        const total = $shared.media.length;
        if (lightboxIndex < 0 || total === 0) return;
        lightboxKey = $shared.media[(lightboxIndex + delta + total) % total].key;
    }

    onDestroy(() => {
        destroyed = true;
        lightboxUnsubscribe?.();
    });
</script>

<div class="shared-panel absolute inset-0 z-[101] flex flex-col" data-testid="sharedPanel">
    <div class="p-2 flex items-center gap-1 border border-solid border-x-0 border-b border-t-0 border-white/10">
        <button
            type="button"
            class="p-3 text-white hover:bg-white/10 rounded-2xl aspect-square w-12 shrink-0"
            data-testid="sharedPanelBack"
            aria-label={$LL.chat.details.title()}
            on:click={back}
        >
            {#if direction === "rtl"}
                <IconChevronRight font-size="20" />
            {:else}
                <IconChevronLeft font-size="20" />
            {/if}
        </button>
        <div class="flex min-w-0 flex-col px-2">
            <div class="truncate text-md font-bold leading-5">{$LL.chat.details.shared()}</div>
            <div class="truncate text-xs text-white/60">{chatName}</div>
        </div>
    </div>

    <SwipeTabs {tabs} active={tab} testId="sharedTabs" on:change={(event) => changeTab(event.detail)}>
        <div slot="page" let:tab={pageTab} class="flex flex-col gap-3 px-4 pb-4">
            {#if pageTab === "media"}
                {#each sharedSections($shared.media, now) as { section, items } (sectionLabel(section))}
                    <section class="flex flex-col gap-2">
                        <h3 class="shared-heading">{sectionLabel(section)}</h3>
                        <div class="grid grid-cols-3 gap-1.5">
                            {#each items as item (item.key)}
                                {@const sender = sharedSender(item.message, $LL.chat.details.you())}
                                <MediaThumb
                                    message={item.message}
                                    {sender}
                                    src={item.src}
                                    video={item.isVideo}
                                    label={item.isVideo
                                        ? $LL.chat.details.video({ name: sender })
                                        : $LL.chat.details.image({ name: sender })}
                                    on:click={() => (lightboxKey = item.key)}
                                />
                            {/each}
                        </div>
                    </section>
                {/each}
            {:else if pageTab === "links"}
                {#each sharedSections($shared.links, now) as { section, items } (sectionLabel(section))}
                    <section class="flex flex-col gap-1">
                        <h3 class="shared-heading">{sectionLabel(section)}</h3>
                        <div class="shared-group">
                            {#each items as item (item.key)}
                                <LinkRow url={item.url ?? item.name} message={item.message} />
                            {/each}
                        </div>
                    </section>
                {/each}
            {:else}
                {#each sharedSections($shared.files, now) as { section, items } (sectionLabel(section))}
                    <section class="flex flex-col gap-1">
                        <h3 class="shared-heading">{sectionLabel(section)}</h3>
                        <div class="shared-group">
                            {#each items as item (item.key)}
                                <FileRow message={item.message} name={item.name} size={item.size} src={item.src} />
                            {/each}
                        </div>
                    </section>
                {/each}
            {/if}

            {#if $shared[tabOf(pageTab)].length === 0 && !loading}
                <p class="py-10 text-center text-sm text-white/50" data-testid="sharedEmpty">
                    {$LL.chat.details.empty[tabOf(pageTab)]()}
                </p>
            {/if}

            {#if loading}
                <div class="flex items-center justify-center gap-2 py-3 text-xs text-white/60" role="status">
                    <IconLoader class="animate-[spin_2s_linear_infinite]" font-size={16} />
                    {$LL.chat.details.lookingFurther()}
                </div>
            {:else if $hasPreviousMessage}
                <button
                    type="button"
                    class="u-menu-row !m-0 justify-center"
                    data-testid="sharedLookFurther"
                    on:click={() => lookFurther()}
                >
                    {$LL.chat.details.lookFurther()}
                </button>
            {/if}
        </div>
    </SwipeTabs>
</div>

<Lightbox
    src={lightboxUrl}
    alt={lightboxItem?.name}
    show={lightboxItem !== undefined}
    isVideo={lightboxItem?.isVideo ?? false}
    filename={lightboxItem?.name}
    hasPrev={$shared.media.length > 1}
    hasNext={$shared.media.length > 1}
    on:close={() => (lightboxKey = undefined)}
    on:prev={() => step(-1)}
    on:next={() => step(1)}
/>

<style>
    .shared-heading {
        margin: 0.25rem 0 0;
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.55);
    }
    .shared-group {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 4px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
    }
</style>
