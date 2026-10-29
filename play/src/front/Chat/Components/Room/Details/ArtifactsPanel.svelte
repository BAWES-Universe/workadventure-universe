<script lang="ts">
    import { getContext, hasContext, onDestroy, onMount } from "svelte";
    import { readable } from "svelte/store";
    import type { Readable } from "svelte/store";
    import LL, { locale } from "../../../../../i18n/i18n-svelte";
    import type { ChatRoom } from "../../../Connection/ChatConnection";
    import { openArtifactsListStore } from "../../../Stores/ChatDetailsStore";
    import { NAME_BY_CHAT_ID_CONTEXT, personName } from "../../../Stores/ChatUserWokaStore";
    import { localUserStore } from "../../../../Connection/LocalUserStore";
    import { canOpenOrbit, openOrbitPage } from "../../../../external-modules/admin-api/index";
    import type { ChatArtifact } from "../../../../Artifacts/ArtifactApi";
    import { ARTIFACT_CHAT_CONTEXT, type ArtifactChatOf } from "../../../../Artifacts/artifactChatContext";
    import { chatArtifactsList, type ChatArtifactsState } from "../../../../Artifacts/chatArtifactsList";
    import ArtifactRow from "./ArtifactRow.svelte";
    import { sharedSectionOf, type SharedSection } from "./SharedItems";
    import { IconChevronLeft, IconChevronRight, IconLoader } from "@wa-icons";

    /**
     * Every artifact made in the chat that the person may open, over its details (game #1474): newest change first
     * under the same week and month headings as its files, the next ones read as the list reaches its end. It ends
     * with the way to all of yours, from every chat, in Orbit. Back returns to the details.
     */
    export let room: ChatRoom;
    /** In a direct chat, the other person: the chat is named after the name they go by now. */
    export let partnerChatId: string | undefined = undefined;
    /** What to call the chat under the title, when its own name isn't what its header shows (nearby chat). */
    export let chatTitle: string | undefined = undefined;

    const direction = document.documentElement.getAttribute("dir") || "ltr";
    const chatOf: ArtifactChatOf = hasContext(ARTIFACT_CHAT_CONTEXT)
        ? getContext(ARTIFACT_CHAT_CONTEXT)
        : () => undefined;
    const chat = chatOf();
    const list = chat ? chatArtifactsList(chat) : undefined;
    const state: Readable<ChatArtifactsState> =
        list ?? readable({ artifacts: [], total: 0, next: null, loading: false, failed: false, loaded: true });
    const roomName = room.name;
    const nameByChatId: Readable<Map<string, string>> = hasContext(NAME_BY_CHAT_ID_CONTEXT)
        ? getContext(NAME_BY_CHAT_ID_CONTEXT)
        : readable(new Map<string, string>());
    $: chatName = chatTitle ?? personName($nameByChatId, partnerChatId, $roomName);
    // A guest owns none, and Orbit is where all of them are
    const showAllYours = localUserStore.isLogged() && canOpenOrbit();
    const now = new Date();

    function label(section: SharedSection): string {
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

    $: sections = $state.artifacts.reduce<{ label: string; items: ChatArtifact[] }[]>((all, artifact) => {
        const name = label(sharedSectionOf(new Date(artifact.updatedAt), now));
        const same = all.find((one) => one.label === name);
        if (same) same.items.push(artifact);
        else all.push({ label: name, items: [artifact] });
        return all;
    }, []);

    function back() {
        openArtifactsListStore.set(undefined);
    }

    function more() {
        list?.loadMore().catch((error) => console.error(error));
    }

    // The next page as the end of the list comes into view; the button stays for when it doesn't (or failed)
    let sentinel: HTMLDivElement | undefined;
    let observer: IntersectionObserver | undefined;
    onMount(() => {
        if (list && !$state.loaded) list.refresh().catch((error) => console.error(error));
        if (typeof IntersectionObserver === "undefined") return;
        observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting) && !$state.failed) more();
        });
    });
    $: if (observer) {
        observer.disconnect();
        if (sentinel) observer.observe(sentinel);
    }
    onDestroy(() => observer?.disconnect());
</script>

<div class="shared-panel absolute inset-0 z-[101] flex flex-col" data-testid="artifactsPanel" data-chat-layer="shared">
    <div class="p-2 flex items-center gap-1 border border-solid border-x-0 border-b border-t-0 border-white/10">
        <button
            type="button"
            class="p-3 text-white hover:bg-white/10 rounded-2xl aspect-square w-12 shrink-0"
            data-testid="artifactsPanelBack"
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
            <div class="truncate text-md font-bold leading-5">{$LL.chat.details.artifacts()}</div>
            <div class="truncate text-xs text-white/60">{chatName}</div>
        </div>
    </div>
    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-3">
        {#if chat}
            {#each sections as section (section.label)}
                <section class="flex flex-col gap-1">
                    <h3 class="shared-heading">{section.label}</h3>
                    <div class="shared-group">
                        {#each section.items as artifact (artifact.id)}
                            <ArtifactRow {artifact} {chat} />
                        {/each}
                    </div>
                </section>
            {/each}
        {/if}

        {#if $state.loaded && $state.artifacts.length === 0 && !$state.failed}
            <p class="py-10 text-center text-sm text-white/50" data-testid="artifactsEmpty">
                {$LL.chat.details.artifactsEmpty()}
            </p>
        {/if}

        {#if $state.loading}
            <div class="flex items-center justify-center gap-2 py-3 text-xs text-white/60" role="status">
                <IconLoader class="animate-[spin_2s_linear_infinite]" font-size={16} />
            </div>
        {:else if $state.failed}
            <div class="flex flex-col items-center gap-2 py-3 text-sm text-white/60" data-testid="artifactsFailed">
                {$LL.chat.details.artifactsFailed()}
                <button
                    type="button"
                    class="u-menu-row !m-0 w-full justify-center"
                    on:click={() => ($state.loaded ? more() : list?.refresh())}
                >
                    {$LL.chat.artifacts.tryAgain()}
                </button>
            </div>
        {:else if $state.next !== null}
            <div bind:this={sentinel}>
                <button
                    type="button"
                    class="u-menu-row !m-0 w-full justify-center"
                    data-testid="artifactsMore"
                    on:click={more}
                >
                    {$LL.chat.details.artifactsMore()}
                </button>
            </div>
        {/if}

        {#if showAllYours}
            <div class="shared-group">
                <button
                    type="button"
                    class="u-menu-row !m-0"
                    data-testid="allYourArtifacts"
                    on:click={() => openOrbitPage("/admin/you/artifacts")}
                >
                    <span class="u-menu-label min-w-0 flex-1 truncate">{$LL.chat.details.allYourArtifacts()}</span>
                    <span class="u-menu-tile !w-6">
                        {#if direction === "rtl"}
                            <IconChevronLeft />
                        {:else}
                            <IconChevronRight />
                        {/if}
                    </span>
                </button>
            </div>
        {/if}
    </div>
</div>

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
