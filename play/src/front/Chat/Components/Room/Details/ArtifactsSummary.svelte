<script lang="ts">
    import { getContext, hasContext, onMount } from "svelte";
    import { readable } from "svelte/store";
    import type { Readable } from "svelte/store";
    import LL from "../../../../../i18n/i18n-svelte";
    import type { ChatRoom } from "../../../Connection/ChatConnection";
    import { openArtifactsListStore } from "../../../Stores/ChatDetailsStore";
    import { ARTIFACT_CHAT_CONTEXT, type ArtifactChatOf } from "../../../../Artifacts/artifactChatContext";
    import { chatArtifactsList, type ChatArtifactsState } from "../../../../Artifacts/chatArtifactsList";
    import ArtifactRow from "./ArtifactRow.svelte";
    import { IconChevronLeft, IconChevronRight } from "@wa-icons";

    /**
     * The "Artifacts" group in a chat's profile or details, above "Media, links and files" (game #1474): how many the
     * person may open and the latest ones. The row opens the page with all of them; a latest one opens straight in the
     * window. A bot's chat with none yet says how to get one; other chats hide the group while it is empty.
     */
    export let room: ChatRoom;
    /** How many of the latest to show under the row. */
    export let latest = 3;
    /** The bot of a direct chat with a bot. */
    export let botName: string | undefined = undefined;

    // The chat the cards of this conversation open from: a bubble's space or a direct chat's room
    const chatOf: ArtifactChatOf = hasContext(ARTIFACT_CHAT_CONTEXT)
        ? getContext(ARTIFACT_CHAT_CONTEXT)
        : () => undefined;
    const chat = chatOf();
    const list = chat ? chatArtifactsList(chat) : undefined;
    const state: Readable<ChatArtifactsState> =
        list ?? readable({ artifacts: [], total: 0, next: null, loading: false, failed: false, loaded: false });
    const direction = document.documentElement.getAttribute("dir") || "ltr";

    onMount(() => {
        list?.refresh().catch((error) => console.error(error));
    });

    $: shown = $state.artifacts.slice(0, latest);
    $: hint = botName !== undefined && $state.loaded && $state.total === 0;

    function open() {
        openArtifactsListStore.set(room.id);
    }
</script>

{#if chat && ($state.total > 0 || hint)}
    <div class="artifacts-summary flex flex-col gap-0.5 rounded-[14px] p-1" data-testid="artifactsSummary">
        <button
            type="button"
            class="u-menu-row !m-0"
            data-testid="artifactsSummaryOpen"
            aria-label={$state.total > 0 ? $LL.chat.details.artifactsOpen({ count: $state.total }) : undefined}
            disabled={$state.total === 0}
            on:click={open}
        >
            <span class="u-menu-label min-w-0 flex-1 truncate">{$LL.chat.details.artifacts()}</span>
            <span class="text-xs tabular-nums text-white/60" data-testid="artifactsSummaryCount">{$state.total}</span>
            {#if $state.total > 0}
                <span class="u-menu-tile !w-6">
                    {#if direction === "rtl"}
                        <IconChevronLeft />
                    {:else}
                        <IconChevronRight />
                    {/if}
                </span>
            {/if}
        </button>
        {#each shown as artifact (artifact.id)}
            <ArtifactRow {artifact} {chat} />
        {/each}
        {#if hint && botName !== undefined}
            <p class="m-0 px-3 pb-3 pt-0 text-xs leading-5 text-white/55" data-testid="artifactsBotHint">
                {$LL.chat.details.artifactsBotHint({ name: botName })}
            </p>
        {/if}
    </div>
{/if}

<style>
    .artifacts-summary {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .u-menu-row:disabled {
        opacity: 1;
        cursor: default;
    }
</style>
