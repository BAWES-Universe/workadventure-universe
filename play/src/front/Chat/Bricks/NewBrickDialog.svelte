<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import type { Action } from "svelte/action";
    import { fly } from "svelte/transition";
    import { closeModal } from "svelte-modals";
    import LL from "../../../i18n/i18n-svelte";
    import WokaImage from "../../Components/Woka/WokaImage.svelte";
    import { botWokaCatalogStore, ensureBotWokaCatalog } from "../../external-modules/bots/stores/BotWokaCatalogStore";
    import { warningMessageStore } from "../../Stores/ErrorStore";
    import TelemetryCard from "../../external-modules/bots/components/page/TelemetryCard.svelte";
    import { BRICK_LOOKS, brickPictureUrl, isBrickLook, type BrickLook } from "./Brick";
    import { openBrickChat } from "./BrickChat";
    import { wokaTextureUrl } from "./BrickLookPicture";
    import BrickPicture from "./BrickPicture.svelte";
    import { firstFreeLook, lookColour } from "./NewBrick";
    import { makeMyBrick, myBricksStore } from "./MyBricksStore";
    import { openTemplateList } from "./Templates/OpenTemplates";
    import { IconCheck, IconChevronDown, IconChevronRight, IconTemplate, IconX } from "@wa-icons";

    /**
     * New Brick (game #1996), in the game's own dialog: today's new bot form with a name and a look, then Create. The
     * Brick talks right away on Universe AI, so there is nothing else to set first. Looks are the Brick colours and
     * the WOKAs the game offers a bot. Advanced settings opens under it, as on the New bot form; for a Brick it says
     * that its chats stay its owner's.
     */
    export let isOpen: boolean;

    type Tab = "bricks" | "wokas";

    const worn = ($myBricksStore ?? []).map((brick) => brick.characterTextureId);
    let look: string = firstFreeLook(worn);
    let tab: Tab = "bricks";
    let busy = false;
    let advancedOpen = false;
    // Closed before Orbit answered: the Brick is still made and listed, but this dialog closes nothing and opens nothing
    let dismissed = false;
    onDestroy(() => (dismissed = true));
    // The name follows the colour until the person writes their own
    let name = suggestedName(look);
    let nameIsOurs = true;

    $: create = $LL.mapEditor.edit.bots.page.create;
    $: wokas = ($botWokaCatalogStore?.woka?.collections ?? []).flatMap((collection) => collection.textures);
    $: ready = name.trim().length > 0 && !busy;

    function suggestedName(ofLook: string): string {
        return isBrickLook(ofLook) ? $LL.chat.brick.lookName({ colour: lookColour(ofLook, $LL) }) : "";
    }

    function pick(next: string) {
        look = next;
        if (nameIsOurs && isBrickLook(next)) name = suggestedName(next);
    }

    async function submit() {
        if (!ready) return;
        busy = true;
        const made = await makeMyBrick(name.trim(), look);
        busy = false;
        if (!made) {
            warningMessageStore.addWarningMessage($LL.chat.brick.makeFailed());
            return;
        }
        if (dismissed || !isOpen) return;
        closeModal();
        openBrickChat(made.id).catch((error) => console.error(error));
    }

    // A dialog keeps the keyboard inside it, and gives focus back to what had it when it closes
    const keepFocusInside: Action<HTMLElement> = (node) => {
        const before = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        const stops = () => Array.from(node.querySelectorAll<HTMLElement>("button:not([disabled]), input"));
        node.querySelector<HTMLElement>("input")?.focus();

        function onKeydown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                event.preventDefault();
                closeModal();
                return;
            }
            if (event.key !== "Tab") return;
            const all = stops();
            const first = all[0];
            const last = all[all.length - 1];
            if (!first || !last) return;
            if (!node.contains(document.activeElement)) {
                event.preventDefault();
                first.focus();
            } else if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
        document.addEventListener("keydown", onKeydown);
        return {
            destroy() {
                document.removeEventListener("keydown", onKeydown);
                before?.focus();
            },
        };
    };

    const looks: readonly BrickLook[] = BRICK_LOOKS;

    onMount(() => {
        ensureBotWokaCatalog().catch((error) => console.warn(error));
    });
</script>

{#if isOpen}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="nbd-scrim" on:click|self={closeModal}>
        <form
            class="nbd u-surface"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-brick-title"
            data-testid="newBrickDialog"
            use:keepFocusInside
            transition:fly={{ y: 16, duration: 200 }}
            on:submit|preventDefault={submit}
        >
            <button
                type="button"
                class="u-close absolute top-2 end-2"
                aria-label={$LL.chat.brick.closeCard()}
                data-testid="newBrickClose"
                on:click={closeModal}
            >
                <IconX font-size="20" />
            </button>
            <h2 id="new-brick-title" class="u-display nbd-title">{$LL.chat.brick.newBrick()}</h2>

            <!-- Someone else's Brick as the start (game #2008): its own look comes first, here only the way in -->
            <button type="button" class="nbd-tpl" data-testid="newBrickFromTemplate" on:click={openTemplateList}>
                <IconTemplate font-size="20" /><span>{$LL.chat.brick.templates.start()}</span>
                <IconChevronRight class="nbd-tpl-go" font-size="18" />
            </button>

            <label class="nbd-l" for="new-brick-name">{create.name()}</label>
            <div class="nbd-namerow">
                <span class="nbd-chosen" aria-hidden="true">
                    {#if isBrickLook(look)}
                        <BrickPicture {look} size={32} />
                    {:else if $botWokaCatalogStore}
                        <WokaImage
                            selectedTextures={{ woka: look }}
                            wokaData={$botWokaCatalogStore}
                            getTextureUrl={wokaTextureUrl}
                            canvasSize={36}
                            direction={0}
                        />
                    {/if}
                </span>
                <input
                    id="new-brick-name"
                    class="nbd-input"
                    type="text"
                    maxlength="64"
                    placeholder={create.namePlaceholder()}
                    data-testid="newBrickName"
                    bind:value={name}
                    on:input={() => (nameIsOurs = false)}
                />
            </div>

            <div class="nbd-l">{$LL.chat.brick.pickLook()}</div>
            {#if wokas.length > 0}
                <div class="nbd-pills" role="tablist">
                    <button
                        type="button"
                        role="tab"
                        class="nbd-pill"
                        aria-selected={tab === "bricks"}
                        data-testid="newBrickTabBricks"
                        on:click={() => (tab = "bricks")}>{$LL.chat.brick.bricks()} <b>{looks.length}</b></button
                    >
                    <button
                        type="button"
                        role="tab"
                        class="nbd-pill"
                        aria-selected={tab === "wokas"}
                        data-testid="newBrickTabWokas"
                        on:click={() => (tab = "wokas")}>{$LL.chat.brick.wokas()} <b>{wokas.length}</b></button
                    >
                </div>
            {/if}
            <div class="nbd-row" data-testid="newBrickLooks">
                {#if tab === "bricks" || wokas.length === 0}
                    {#each looks as one (one)}
                        <button
                            type="button"
                            class="nbd-tile"
                            class:on={look === one}
                            aria-pressed={look === one}
                            aria-label={lookColour(one, $LL)}
                            title={lookColour(one, $LL)}
                            data-testid="newBrickLook"
                            on:click={() => pick(one)}
                        >
                            <img src={brickPictureUrl(one)} alt="" draggable="false" width="36" height="36" />
                            {#if look === one}<span class="nbd-ck"><IconCheck font-size="12" /></span>{/if}
                        </button>
                    {/each}
                {:else}
                    {#each wokas as texture (texture.id)}
                        <button
                            type="button"
                            class="nbd-tile"
                            class:on={look === texture.id}
                            aria-pressed={look === texture.id}
                            aria-label={texture.name}
                            title={texture.name}
                            data-testid="newBrickWoka"
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
                            {#if look === texture.id}<span class="nbd-ck"><IconCheck font-size="12" /></span>{/if}
                        </button>
                    {/each}
                {/if}
            </div>

            <p class="nbd-note">{$LL.chat.brick.readyToTalk()}</p>

            <div class="nbd-adv">
                <button
                    type="button"
                    class="nbd-disclosure"
                    class:open={advancedOpen}
                    aria-expanded={advancedOpen}
                    aria-controls="new-brick-advanced"
                    data-testid="newBrickAdvanced"
                    on:click={() => (advancedOpen = !advancedOpen)}
                >
                    <span>{$LL.mapEditor.edit.bots.page.telemetry.newBotAdvanced()}</span>
                    <span class="nbd-chev"><IconChevronDown font-size="18" /></span>
                </button>
                {#if advancedOpen}
                    <div id="new-brick-advanced">
                        <TelemetryCard
                            on={false}
                            locked
                            lockedHint={$LL.chat.brick.telemetryOff()}
                            onChange={() => {}}
                        />
                    </div>
                {/if}
            </div>

            <div class="nbd-foot">
                <button type="button" class="nbd-btn" data-testid="newBrickCancel" on:click={closeModal}
                    >{create.cancel()}</button
                >
                <button type="submit" class="nbd-btn nbd-cta" disabled={!ready} data-testid="newBrickCreate">
                    {create.create()}
                </button>
            </div>
        </form>
    </div>
{/if}

<style>
    .nbd-scrim {
        position: fixed;
        inset: 0;
        z-index: 2001;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 12px;
        background: rgba(10, 8, 20, 0.45);
        pointer-events: auto;
    }
    .nbd {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: 100%;
        max-width: 400px;
        max-height: 100%;
        overflow-y: auto;
        box-sizing: border-box;
        margin: 0;
        padding: 16px;
        border-radius: 16px;
        color: #fff;
        text-align: start;
        font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    .nbd button,
    .nbd input {
        font-family: inherit;
    }
    .nbd-title {
        margin: 0 0 2px;
        padding: 4px 48px 0 4px;
        font-size: 20px;
        line-height: 28px;
    }
    :global([dir="rtl"]) .nbd-title {
        padding: 4px 4px 0 48px;
    }
    .nbd-tpl {
        display: flex;
        align-items: center;
        gap: 12px;
        flex: none;
        width: 100%;
        min-height: 48px;
        margin: 0;
        padding: 0 8px 0 12px;
        border: 0;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.06);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        text-align: start;
        cursor: pointer;
    }
    .nbd-tpl span {
        flex: 1;
    }
    .nbd-tpl:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    :global([dir="rtl"]) .nbd-tpl :global(.nbd-tpl-go) {
        transform: scaleX(-1);
    }
    @media (hover: hover) {
        .nbd-tpl:hover {
            background: rgba(255, 255, 255, 0.1);
        }
    }
    .nbd-l {
        padding: 0 4px;
        font-size: 13px;
        font-weight: 600;
    }
    .nbd-namerow {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .nbd-chosen {
        display: grid;
        place-items: center;
        flex: none;
        width: 44px;
        height: 44px;
        overflow: hidden;
        border-radius: 12px;
        background: rgba(167, 139, 250, 0.16);
        border: 1px solid rgba(167, 139, 250, 0.45);
    }
    .nbd-input {
        flex: 1;
        min-width: 0;
        height: 44px;
        margin: 0;
        padding: 0 12px;
        border: 0;
        border-radius: 12px;
        background: rgba(0, 0, 0, 0.25);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        font-size: 16px;
        color: #fff;
        outline: none;
    }
    .nbd-input::placeholder {
        color: rgba(244, 242, 250, 0.42);
    }
    .nbd-input:focus-visible {
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.6);
    }
    .nbd-pills {
        display: flex;
        gap: 8px;
        padding: 0 2px;
    }
    .nbd-pill {
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
    .nbd-pill b {
        font-weight: 600;
        font-size: 12px;
        opacity: 0.7;
    }
    .nbd-pill[aria-selected="true"] {
        border-color: transparent;
        color: #fff;
        background: linear-gradient(90deg, #7b2ff7, #4353ff);
    }
    .nbd-pill:focus-visible,
    .nbd-tile:focus-visible,
    .nbd-btn:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .nbd-row {
        display: flex;
        gap: 8px;
        flex: none;
        overflow-x: auto;
        overflow-y: hidden;
        scroll-snap-type: x mandatory;
        padding: 2px 2px 6px;
        scrollbar-width: none;
    }
    .nbd-row::-webkit-scrollbar {
        display: none;
    }
    .nbd-tile {
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
        scroll-snap-align: start;
        cursor: pointer;
    }
    .nbd-tile img {
        image-rendering: pixelated;
    }
    .nbd-tile.on {
        background: linear-gradient(145deg, rgba(134, 41, 252, 0.28), rgba(65, 86, 246, 0.18));
        box-shadow: inset 0 0 0 2px rgba(196, 181, 253, 0.95);
    }
    .nbd-ck {
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
    .nbd-note {
        margin: 0;
        padding: 0 4px;
        font-size: 13px;
        line-height: 1.35;
        color: rgba(255, 255, 255, 0.68);
    }
    /* Advanced settings, as on the New bot form (NewBotView): a quiet row that opens in place */
    .nbd-adv {
        display: flex;
        flex-direction: column;
        gap: 6px;
        flex: none;
    }
    .nbd-disclosure {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        height: 44px;
        margin: 0;
        padding: 0 8px 0 4px;
        border: 0;
        border-radius: 12px;
        background: transparent;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        color: #fff;
        text-align: start;
        cursor: pointer;
    }
    @media (hover: hover) {
        .nbd-disclosure:hover {
            background: rgba(255, 255, 255, 0.05);
        }
    }
    .nbd-disclosure:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: -2px;
    }
    .nbd-chev {
        display: grid;
        place-items: center;
        flex: none;
        color: rgba(244, 242, 250, 0.64);
        transform: rotate(-90deg);
    }
    :global([dir="rtl"]) .nbd-chev {
        transform: rotate(90deg);
    }
    .nbd-disclosure.open .nbd-chev {
        transform: none;
        color: #fff;
    }
    .nbd-foot {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        padding-top: 4px;
    }
    .nbd-btn {
        height: 44px;
        margin: 0;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
    }
    .nbd-cta {
        background: linear-gradient(90deg, #8629fc, #4156f6);
        box-shadow: 0 8px 24px -10px rgba(134, 41, 252, 0.8);
    }
    .nbd-btn:disabled {
        opacity: 0.5;
        cursor: default;
    }
</style>
