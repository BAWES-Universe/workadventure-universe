<script lang="ts">
    import { onMount } from "svelte";
    import LL from "../../../i18n/i18n-svelte";
    import WokaImage from "../../Components/Woka/WokaImage.svelte";
    import { botWokaCatalogStore, ensureBotWokaCatalog } from "../../external-modules/bots/stores/BotWokaCatalogStore";
    import { BRICK_LOOKS, brickPictureUrl, isBrickLook, type BrickLook } from "./Brick";
    import { wokaTextureUrl } from "./BrickLookPicture";
    import { lookColour } from "./NewBrick";
    import { IconCheck, IconChevronLeft } from "@wa-icons";

    /**
     * A Brick's look on its own page (game Slice 13): the circle on top opens this, in place of the page. The same
     * two pills and tiles as New Brick (the Brick colours, and the WOKAs the game offers a bot), and a tap saves: there
     * is no Save to press, the page comes back with the new look.
     */
    export let look: string;
    export let name: string;
    /** Saves the look. Resolves false when it was not saved: the picker stays open so a tap can be tried again. */
    export let onPick: (look: string) => Promise<boolean>;
    export let onBack: () => void;

    type Tab = "bricks" | "wokas";

    const looks: readonly BrickLook[] = BRICK_LOOKS;
    let tab: Tab = isBrickLook(look) ? "bricks" : "wokas";
    let busy = false;
    /** The last tap was not saved: say so, the picker stays open so a tap can be tried again */
    let failed = false;
    $: wokas = ($botWokaCatalogStore?.woka?.collections ?? []).flatMap((collection) => collection.textures);

    function pick(next: string) {
        if (busy) return;
        if (next === look) {
            onBack();
            return;
        }
        busy = true;
        failed = false;
        onPick(next)
            .catch(() => false)
            .then((saved) => {
                busy = false;
                failed = !saved;
                if (saved) onBack();
            })
            .catch((error) => console.error(error));
    }

    onMount(() => {
        ensureBotWokaCatalog().catch((error) => console.warn(error));
    });
</script>

<div class="blp" data-testid="brickLookPicker">
    <button type="button" class="blp-back" data-testid="brickLookBack" on:click={onBack}>
        <IconChevronLeft font-size="20" />
        <span>{$LL.chat.brick.backToBrick({ name })}</span>
    </button>
    <h2 class="blp-title">{$LL.chat.brick.pickLook()}</h2>
    {#if wokas.length > 0}
        <div class="blp-pills" role="tablist">
            <button
                type="button"
                role="tab"
                class="blp-pill"
                aria-selected={tab === "bricks"}
                data-testid="brickLookTabBricks"
                on:click={() => (tab = "bricks")}>{$LL.chat.brick.bricks()} <b>{looks.length}</b></button
            >
            <button
                type="button"
                role="tab"
                class="blp-pill"
                aria-selected={tab === "wokas"}
                data-testid="brickLookTabWokas"
                on:click={() => (tab = "wokas")}>{$LL.chat.brick.wokas()} <b>{wokas.length}</b></button
            >
        </div>
    {/if}
    {#if failed}
        <p class="blp-error" role="alert" data-testid="brickLookError">
            {$LL.mapEditor.edit.bots.page.telemetry.saveFailed()}
        </p>
    {/if}
    <div class="blp-grid" data-testid="brickLookTiles">
        {#if tab === "bricks" || wokas.length === 0}
            {#each looks as one (one)}
                <button
                    type="button"
                    class="blp-tile"
                    class:on={look === one}
                    aria-pressed={look === one}
                    aria-label={lookColour(one, $LL)}
                    title={lookColour(one, $LL)}
                    disabled={busy}
                    data-testid="brickLookTile"
                    on:click={() => pick(one)}
                >
                    <img src={brickPictureUrl(one)} alt="" draggable="false" width="36" height="36" />
                    {#if look === one}<span class="blp-ck"><IconCheck font-size="12" /></span>{/if}
                </button>
            {/each}
        {:else}
            {#each wokas as texture (texture.id)}
                <button
                    type="button"
                    class="blp-tile"
                    class:on={look === texture.id}
                    aria-pressed={look === texture.id}
                    aria-label={texture.name}
                    title={texture.name}
                    disabled={busy}
                    data-testid="brickLookWoka"
                    on:click={() => pick(texture.id)}
                >
                    {#if $botWokaCatalogStore}
                        <WokaImage
                            selectedTextures={{ woka: texture.id }}
                            wokaData={$botWokaCatalogStore}
                            getTextureUrl={wokaTextureUrl}
                            canvasSize={40}
                            direction={0}
                        />
                    {/if}
                    {#if look === texture.id}<span class="blp-ck"><IconCheck font-size="12" /></span>{/if}
                </button>
            {/each}
        {/if}
    </div>
</div>

<style>
    .blp-error {
        margin: 0;
        font-size: 12.5px;
        color: #ff8a7a;
    }
    .blp {
        display: flex;
        flex-direction: column;
        gap: 10px;
        color: #fff;
    }
    .blp button {
        font-family: inherit;
    }
    .blp-back {
        display: inline-flex;
        align-items: center;
        align-self: flex-start;
        gap: 4px;
        min-height: 44px;
        margin: 0;
        padding: 0 12px 0 4px;
        border: 0;
        border-radius: 999px;
        background: transparent;
        font-size: 14px;
        font-weight: 600;
        color: rgba(244, 242, 250, 0.82);
        cursor: pointer;
    }
    :global([dir="rtl"]) .blp-back :global(svg) {
        transform: scaleX(-1);
    }
    .blp-title {
        margin: 0;
        padding: 0 4px;
        font-size: 18px;
        font-weight: 650;
        line-height: 1.3;
    }
    .blp-pills {
        display: flex;
        gap: 8px;
        padding: 0 2px;
    }
    .blp-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 44px;
        margin: 0;
        padding: 0 16px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.04);
        color: rgba(255, 255, 255, 0.75);
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
    }
    .blp-pill b {
        font-weight: 600;
        font-size: 12px;
        opacity: 0.7;
    }
    .blp-pill[aria-selected="true"] {
        border-color: transparent;
        color: #fff;
        background: linear-gradient(90deg, #7b2ff7, #4353ff);
    }
    .blp-pill:focus-visible,
    .blp-tile:focus-visible,
    .blp-back:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .blp-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding: 2px;
    }
    .blp-tile {
        position: relative;
        display: grid;
        place-items: center;
        flex: none;
        width: 56px;
        height: 56px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.04);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
        cursor: pointer;
    }
    .blp-tile:disabled {
        opacity: 0.6;
        cursor: default;
    }
    .blp-tile img {
        image-rendering: pixelated;
    }
    .blp-tile.on {
        background: linear-gradient(145deg, rgba(134, 41, 252, 0.28), rgba(65, 86, 246, 0.18));
        box-shadow: inset 0 0 0 2px rgba(196, 181, 253, 0.95);
    }
    .blp-ck {
        position: absolute;
        top: 4px;
        inset-inline-end: 4px;
        display: grid;
        place-items: center;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: linear-gradient(135deg, #8629fc, #4156f6);
        color: #fff;
    }
</style>
