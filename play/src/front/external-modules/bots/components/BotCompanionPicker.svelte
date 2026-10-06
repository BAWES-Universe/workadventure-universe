<script lang="ts">
    // The companion (pet) that walks with the bot: None, then the room's companions, grouped as the room lists them.
    // Same shape as the WOKA picker above it on the page.
    import { onMount } from "svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import { ABSOLUTE_PUSHER_URL } from "../../../Enum/ComputedConst";
    import {
        botCompanionCatalogStore,
        ensureBotCompanionCatalog,
        findCompanion,
    } from "../stores/BotCompanionCatalogStore";
    import CompanionSprite from "./page/CompanionSprite.svelte";
    import { IconForbid } from "@wa-icons";

    /** The bot's companion, or null for none */
    export let selectedId: string | null = null;
    export let onSelect: (companionTextureId: string | null) => void;

    $: page = $LL.mapEditor.edit.bots.page.companion;
    $: catalog = $botCompanionCatalogStore;
    $: selected = findCompanion(catalog, selectedId);
    $: collections = (catalog ?? []).filter((collection) => collection.textures.length > 0);
    // Opens on the collection holding the bot's companion
    let collectionIndex = 0;
    $: if (selected) {
        const index = collections.findIndex((collection) => collection.textures.some((t) => t.id === selected?.id));
        if (index >= 0) collectionIndex = index;
    }
    $: textures = collections[Math.min(collectionIndex, Math.max(collections.length - 1, 0))]?.textures ?? [];

    function textureUrl(url: string): string {
        if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) {
            return url;
        }
        return `${ABSOLUTE_PUSHER_URL}${url.replace(/^\//, "")}`;
    }

    onMount(() => {
        void ensureBotCompanionCatalog();
    });
</script>

<div class="bot-companion-picker">
    {#if catalog === null}
        <div class="flex items-center justify-center py-8">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
    {:else}
        <div class="space-y-4">
            <!-- Preview: the companion it has now -->
            <div class="flex items-center justify-center gap-3 p-4 bg-white/5 rounded-lg border border-white/20">
                {#if selected}
                    <CompanionSprite url={textureUrl(selected.url)} size={96} />
                    <span class="text-sm font-medium">{selected.name}</span>
                {:else}
                    <span class="text-white/60"><IconForbid font-size="40" /></span>
                    <span class="text-sm font-medium text-white/60">{page.noneOption()}</span>
                {/if}
            </div>

            <!-- One collection at a time, as on the join screen -->
            {#if collections.length > 1}
                <div class="cp-pills" role="tablist">
                    {#each collections as collection, index (collection.name)}
                        <button
                            type="button"
                            role="tab"
                            class="cp-pill"
                            aria-selected={index === collectionIndex}
                            on:click={() => (collectionIndex = index)}
                        >
                            {collection.name}
                        </button>
                    {/each}
                </div>
            {/if}

            <div class="max-h-[300px] overflow-y-auto">
                <div class="cp-grid">
                    <button
                        type="button"
                        class="cp-tile"
                        class:cp-on={!selected}
                        aria-pressed={!selected}
                        data-testid="bot-companion-none"
                        on:click={() => onSelect(null)}
                    >
                        <span class="cp-art text-white/60"><IconForbid font-size="32" /></span>
                        <span class="cp-name">{page.noneOption()}</span>
                    </button>
                    {#each textures as texture (texture.id)}
                        <button
                            type="button"
                            class="cp-tile"
                            class:cp-on={selected?.id === texture.id}
                            aria-pressed={selected?.id === texture.id}
                            title={texture.name}
                            data-testid="bot-companion-{texture.id}"
                            on:click={() => onSelect(texture.id)}
                        >
                            <span class="cp-art"><CompanionSprite url={textureUrl(texture.url)} size={64} /></span>
                            <span class="cp-name">{texture.name}</span>
                        </button>
                    {/each}
                </div>
                {#if collections.length === 0}
                    <p class="text-sm text-white/60 mt-3">{page.empty()}</p>
                {/if}
            </div>
        </div>
    {/if}
</div>

<style>
    .bot-companion-picker {
        color: white;
    }
    .cp-pills {
        display: flex;
        gap: 6px;
        overflow-x: auto;
        scrollbar-width: none;
    }
    .cp-pill {
        flex: none;
        min-height: 36px;
        padding: 6px 14px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.75);
        cursor: pointer;
    }
    .cp-pill[aria-selected="true"] {
        background: rgba(255, 255, 255, 0.18);
        color: #fff;
    }
    .cp-pill:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    /* Tiles fill the width, three or more to a row even on a phone */
    .cp-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(68px, 1fr));
        gap: 8px;
    }
    /* Same tile as the WOKA picker, with room for the name underneath */
    .cp-tile {
        display: flex;
        flex-direction: column;
        align-items: center;
        min-width: 0;
        padding: 2px 0 4px;
        border: 2px solid rgba(255, 255, 255, 0.2);
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.05);
        color: #fff;
        cursor: pointer;
        transition: border-color 0.15s, background-color 0.15s;
    }
    @media (hover: hover) {
        .cp-tile:hover {
            border-color: rgba(255, 255, 255, 0.4);
            background: rgba(255, 255, 255, 0.1);
        }
    }
    .cp-tile.cp-on {
        border-color: #3b82f6;
        background: rgba(59, 130, 246, 0.2);
    }
    .cp-tile:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .cp-art {
        display: grid;
        place-items: center;
        width: 64px;
        height: 64px;
    }
    .cp-name {
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
        line-height: 1.3;
        color: rgba(255, 255, 255, 0.75);
    }
</style>
