<script lang="ts">
    // New bot, inside the panel: a name and a WOKA, then Create. The rest is set on its page.
    import { onMount } from "svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import { ABSOLUTE_PUSHER_URL } from "../../../Enum/ComputedConst";
    import WokaImage from "../../../Components/Woka/WokaImage.svelte";
    import { botWokaCatalogStore, ensureBotWokaCatalog } from "../stores/BotWokaCatalogStore";
    import { IconCheck } from "@wa-icons";

    export let busy = false;
    export let onCreate: (name: string, textureId: string) => void;
    export let onCancel: () => void;

    let name = "";
    let textureId = "";

    $: page = $LL.mapEditor.edit.bots.page;
    $: collections = $botWokaCatalogStore?.["woka"]?.collections ?? [];
    $: if (!textureId && collections[0]?.textures?.[0]) {
        textureId = collections[0].textures[0].id;
    }
    $: ready = name.trim().length > 0 && !!textureId && !busy;

    function getTextureUrl(relativeUrl: string): string {
        if (relativeUrl.startsWith("http://") || relativeUrl.startsWith("https://")) {
            return relativeUrl;
        }
        return `${ABSOLUTE_PUSHER_URL}${relativeUrl}`;
    }

    function submit() {
        if (ready) onCreate(name.trim(), textureId);
    }

    onMount(() => {
        void ensureBotWokaCatalog();
    });
</script>

<form class="nb" data-testid="new-bot" on:submit|preventDefault={submit}>
    <h3 class="nb-title">{page.create.title()}</h3>
    <label class="nb-field">
        <span class="nb-l">{page.create.name()}</span>
        <!-- svelte-ignore a11y-autofocus -->
        <input
            class="nb-input"
            type="text"
            maxlength="64"
            placeholder={page.create.namePlaceholder()}
            autofocus
            data-testid="new-bot-name"
            bind:value={name}
        />
    </label>
    <div class="nb-l">{page.create.woka()}</div>
    <div class="nb-scroll">
        {#each collections as collection (collection.name)}
            {#if collections.length > 1}
                <div class="nb-coll">{collection.name}</div>
            {/if}
            <div class="nb-grid">
                {#each collection.textures as texture (texture.id)}
                    <button
                        type="button"
                        class="nb-tile"
                        class:on={textureId === texture.id}
                        aria-pressed={textureId === texture.id}
                        title={texture.name}
                        on:click={() => (textureId = texture.id)}
                    >
                        {#if $botWokaCatalogStore}
                            <WokaImage
                                selectedTextures={{ woka: texture.id }}
                                wokaData={$botWokaCatalogStore}
                                {getTextureUrl}
                                canvasSize={48}
                                direction={0}
                            />
                        {/if}
                        {#if textureId === texture.id}
                            <span class="nb-ck"><IconCheck font-size="12" /></span>
                        {/if}
                    </button>
                {/each}
            </div>
        {/each}
    </div>
    <div class="nb-foot">
        <button type="button" class="nb-btn" on:click={onCancel}>{page.create.cancel()}</button>
        <button type="submit" class="nb-btn nb-cta" disabled={!ready} data-testid="new-bot-create">
            {page.create.create()}
        </button>
    </div>
</form>

<style>
    .nb {
        display: flex;
        flex-direction: column;
        gap: 10px;
        flex: 1;
        min-height: 0;
        color: #fff;
    }
    .nb-title {
        margin: 0;
        padding: 0 4px;
        font-size: 18px;
        font-weight: 650;
        letter-spacing: -0.01em;
        text-transform: none;
    }
    .nb-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .nb-l {
        padding: 0 4px;
        font-size: 13px;
        font-weight: 600;
    }
    .nb-input {
        width: 100%;
        height: 44px;
        margin: 0;
        padding: 0 12px;
        border: 0;
        border-radius: 12px;
        background: rgba(0, 0, 0, 0.25);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        font: inherit;
        font-size: 15px;
        color: #fff;
        outline: none;
    }
    .nb-input::placeholder {
        color: rgba(244, 242, 250, 0.42);
    }
    .nb-input:focus-visible {
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.6);
    }
    .nb-scroll {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 2px 4px;
    }
    .nb-coll {
        margin: 6px 0;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(244, 242, 250, 0.5);
    }
    .nb-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
        gap: 8px;
        margin-bottom: 8px;
    }
    .nb-tile {
        position: relative;
        display: grid;
        place-items: center;
        aspect-ratio: 1;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.04);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
        cursor: pointer;
    }
    .nb-tile.on {
        background: linear-gradient(145deg, rgba(134, 41, 252, 0.28), rgba(65, 86, 246, 0.18));
        box-shadow: inset 0 0 0 2px rgba(196, 181, 253, 0.95);
    }
    .nb-tile:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .nb-ck {
        position: absolute;
        top: 5px;
        right: 5px;
        display: grid;
        place-items: center;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: linear-gradient(135deg, #8629fc, #4156f6);
        color: #fff;
    }
    .nb-foot {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        padding-top: 4px;
    }
    .nb-btn {
        height: 44px;
        margin: 0;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
    }
    .nb-cta {
        background: linear-gradient(90deg, #8629fc, #4156f6);
        box-shadow: 0 8px 24px -10px rgba(134, 41, 252, 0.8);
    }
    .nb-btn:disabled {
        opacity: 0.5;
        cursor: default;
    }
    .nb-btn:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
</style>
