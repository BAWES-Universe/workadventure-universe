<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { connectionManager } from "../../Connection/ConnectionManager";
    import type { SaveResult } from "../../Connection/ConnectionManager";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import { selectCharacterSceneVisibleStore } from "../../Stores/SelectCharacterStore";
    import { selectCompanionSceneVisibleStore } from "../../Stores/SelectCompanionStore";
    import { refusedPickerStore, wokaRefusedStore } from "../../Stores/WokaRefusedStore";
    import type { RefusedKind } from "../../Stores/WokaRefusedStore";
    import { SelectCharacterSceneName } from "../../Phaser/Login/SelectCharacterScene";
    import { SelectCompanionSceneName } from "../../Phaser/Login/SelectCompanionScene";
    import { EnableCameraSceneName } from "../../Phaser/Login/EnableCameraScene";
    import SheetSprite from "../Join/SheetSprite.svelte";
    import WokaImage from "./WokaImage.svelte";
    import { fetchWokaData, fetchWokaMine, getWokaTextureUrl } from "./WokaData";
    import { buildWokaRefusal } from "./WokaRefusal";
    import type { WokaRefusal } from "./WokaRefusal";
    import { IconAlertTriangle, IconArrowRight, IconBan, IconCheck, IconMapPin, IconPaw, IconUser } from "@wa-icons";

    export let kind: RefusedKind;

    const isCompanion = kind === "companion";
    const placeName = gameManager.currentMapRoom?.roomName;

    let refusal: WokaRefusal | undefined;
    /** The companion you have, when the server drew it for us (its picture, as the pusher serves it) */
    let companionUrl: string | undefined;
    let loading = true;
    let saving = false;
    let error = "";
    let destroyed = false;

    // A function, so a save that ends after the player tapped away can still release the buttons
    function setSaving(value: boolean) {
        saving = value;
    }

    $: current = refusal?.current;
    $: suggestion = refusal?.suggestion;

    // The line under the faded WOKA, from why it cannot be worn here. A guest has no reason, so no line.
    $: currentLine = (() => {
        if (!current?.reason) return "";
        if (current.reason === "removed") return $LL.woka.refused.noLongerAvailable();
        if (current.reason === "no_access") return $LL.woka.refused.notAvailableToYou();
        return current.placeName
            ? $LL.woka.refused.onlyIn({ place: current.placeName })
            : $LL.woka.refused.notAvailableHere();
    })();

    onMount(() => {
        load().catch((err) => console.error(err));
    });

    onDestroy(() => {
        destroyed = true;
    });

    async function load() {
        // Signed-in players: the server says what they wear and what to offer. Guests and failures: the device and the
        // room's own list.
        const mine = await fetchWokaMine();
        if (destroyed) return;
        if (isCompanion) {
            companionUrl = mine?.companion?.url;
            loading = false;
            return;
        }
        const wokaData = await fetchWokaData().catch((err) => {
            console.warn("Cannot load the WOKA list:", err);
            return undefined;
        });
        if (destroyed) return;
        refusal = buildWokaRefusal(mine, wokaData, gameManager.getCharacterTextureIds());
        if (!refusal) {
            // Nothing to suggest: the picker, as before this popup
            wokaRefusedStore.set(undefined);
            selectCharacterSceneVisibleStore.set(true);
            return;
        }
        loading = false;
    }

    function errorFor(result: SaveResult): string {
        if (isCompanion) {
            return result === "notAllowed"
                ? $LL.woka.refused.companionSaveNotAllowed()
                : $LL.woka.refused.companionSaveFailed();
        }
        return result === "notAllowed" ? $LL.woka.refused.saveNotAllowed() : $LL.woka.refused.saveFailed();
    }

    // The same way out as the pickers: back into the room, which joins again with what was just saved
    function joinAgain() {
        wokaRefusedStore.set(undefined);
        refusedPickerStore.set(undefined);
        gameManager.tryToStopScene(isCompanion ? SelectCompanionSceneName : SelectCharacterSceneName);
        gameManager.tryResumingGame(EnableCameraSceneName);
    }

    async function wearThis() {
        if (saving || !suggestion) return;
        saving = true;
        error = "";
        try {
            const result = await connectionManager.saveTextures(suggestion.textureIds);
            if (result !== "saved") {
                error = errorFor(result);
                return;
            }
            gameManager.setCharacterTextureIds(suggestion.textureIds);
            joinAgain();
        } catch (err) {
            console.error("Error saving textures:", err);
            error = errorFor("failed");
        } finally {
            setSaving(false);
        }
    }

    async function goWithoutOne() {
        if (saving) return;
        saving = true;
        error = "";
        try {
            const result = await connectionManager.saveCompanionTexture(null);
            if (result !== "saved") {
                error = errorFor(result);
                return;
            }
            localUserStore.setCompanionTextureId(null);
            gameManager.setCompanionTextureId(null);
            joinAgain();
        } catch (err) {
            console.error("Error saving the companion:", err);
            error = errorFor("failed");
        } finally {
            setSaving(false);
        }
    }

    // The picker's close button leads back here (refusedPickerStore), because there is no room to return to yet
    function chooseAnother() {
        if (saving) return;
        error = "";
        refusedPickerStore.set(kind);
        wokaRefusedStore.set(undefined);
        if (isCompanion) selectCompanionSceneVisibleStore.set(true);
        else selectCharacterSceneVisibleStore.set(true);
    }

    const bgColor = gameManager.currentMapRoom?.backgroundColor ?? "#000000";
</script>

<div class="refused-backdrop fixed inset-0" style="background-color: {bgColor};" />
<div class="refused-dim fixed inset-0" />

<div class="refused-scene pointer-events-auto fixed inset-0 flex items-center justify-center px-3">
    {#if !loading}
        <div
            class="refused-card u-surface w-full md:w-[400px] flex flex-col gap-3.5 p-4 text-white"
            role="dialog"
            aria-modal="true"
            aria-labelledby="refused-title"
        >
            {#if placeName}
                <span class="refused-eyebrow"><IconMapPin font-size="14" />{placeName}</span>
            {/if}
            <h2 id="refused-title" class="refused-title">
                {isCompanion ? $LL.woka.refused.companionTitle() : $LL.woka.refused.wokaTitle()}
            </h2>

            <div class="flex items-center gap-2.5">
                <!-- What you wear now, faded: this place cannot show it -->
                <div class="refused-look" class:refused-single={isCompanion}>
                    <div class="refused-box refused-box-no">
                        {#if isCompanion}
                            {#if companionUrl}
                                <SheetSprite url={getWokaTextureUrl(companionUrl)} size={64} />
                            {:else}
                                <IconPaw font-size="32" />
                            {/if}
                        {:else if current && current.layers.length > 0}
                            <WokaImage
                                selectedTextures={{}}
                                layers={current.layers}
                                getTextureUrl={getWokaTextureUrl}
                                canvasSize={64}
                            />
                        {:else}
                            <IconUser font-size="32" />
                        {/if}
                        <span class="refused-badge"><IconBan font-size="14" /></span>
                    </div>
                    <b
                        >{isCompanion
                            ? $LL.woka.refused.yourCompanion()
                            : current?.name ?? $LL.woka.refused.yourWoka()}</b
                    >
                    {#if !isCompanion && currentLine}<span>{currentLine}</span>{/if}
                </div>

                {#if !isCompanion}
                    <span class="refused-arrow"><IconArrowRight font-size="22" /></span>

                    <!-- What this place can show instead -->
                    <div class="refused-look">
                        <div class="refused-box refused-box-yes">
                            {#if suggestion}
                                <WokaImage
                                    selectedTextures={{}}
                                    layers={suggestion.layers}
                                    getTextureUrl={getWokaTextureUrl}
                                    canvasSize={64}
                                />
                            {/if}
                            <span class="refused-badge refused-badge-ok"><IconCheck font-size="14" /></span>
                        </div>
                        <b>{suggestion?.name ?? $LL.woka.refused.yourLastWoka()}</b>
                        <span>
                            {suggestion?.lastWorn ? $LL.woka.refused.lastWorn() : $LL.woka.refused.availableHere()}
                        </span>
                    </div>
                {/if}
            </div>

            <p class="refused-text">{$LL.woka.refused.text()}</p>

            {#if error}
                <p class="refused-error" role="alert">
                    <IconAlertTriangle font-size="18" />
                    <span>{error}</span>
                </p>
            {/if}

            <div class="flex gap-2">
                {#if isCompanion}
                    <button
                        type="button"
                        class="u-join-btn u-cta refused-pill"
                        disabled={saving}
                        on:click={chooseAnother}
                    >
                        {$LL.woka.refused.chooseAnother()}
                    </button>
                    <button
                        type="button"
                        class="u-join-btn u-cta-secondary refused-pill"
                        disabled={saving}
                        on:click={goWithoutOne}
                    >
                        {$LL.woka.refused.goWithoutOne()}
                    </button>
                {:else}
                    <button type="button" class="u-join-btn u-cta refused-pill" disabled={saving} on:click={wearThis}>
                        <IconCheck font-size="18" />
                        {$LL.woka.refused.wearThis()}
                    </button>
                    <button
                        type="button"
                        class="u-join-btn u-cta-secondary refused-pill"
                        disabled={saving}
                        on:click={chooseAnother}
                    >
                        {$LL.woka.refused.chooseAnother()}
                    </button>
                {/if}
            </div>
        </div>
    {:else}
        <div class="refused-spinner" />
    {/if}
</div>

<style lang="scss">
    .refused-backdrop {
        z-index: 0;
    }
    .refused-dim {
        z-index: 1;
        background: rgba(10, 8, 20, 0.62);
    }
    .refused-scene {
        z-index: 2;
    }
    .refused-card {
        max-width: 428px;
        border-radius: 20px;
    }
    .refused-eyebrow {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #c4b5fd;
    }
    .refused-title {
        margin: 0;
        font-size: 1.25rem;
        line-height: 1.15;
        font-weight: 800;
        text-transform: none;
        letter-spacing: normal;
        color: #fff;
    }
    .refused-look {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        text-align: center;
    }
    .refused-single {
        flex: none;
        width: 50%;
        margin: 0 auto;
    }
    .refused-look b {
        font-size: 13px;
    }
    .refused-look span {
        font-size: 12px;
        line-height: 1.3;
        color: rgba(255, 255, 255, 0.62);
    }
    .refused-box {
        position: relative;
        display: grid;
        place-items: center;
        width: 100%;
        height: 96px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.06);
        line-height: 0;
    }
    .refused-box-no :global(canvas),
    .refused-box-no :global(svg),
    .refused-box-no :global(.sheet-sprite) {
        opacity: 0.42;
    }
    .refused-box-yes {
        background: rgba(196, 181, 253, 0.1);
        box-shadow: 0 0 0 2px #c4b5fd;
    }
    .refused-badge {
        position: absolute;
        top: 6px;
        right: 6px;
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: rgba(233, 109, 81, 0.22);
        color: #ffd9cf;
    }
    .refused-badge-ok {
        background: #c4b5fd;
        color: #14121e;
    }
    .refused-arrow {
        flex: none;
        color: rgba(255, 255, 255, 0.55);
    }
    .refused-text {
        margin: 0;
        font-size: 13px;
        line-height: 1.4;
        color: rgba(255, 255, 255, 0.72);
    }
    .refused-error {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
        margin: 0;
        padding: 0.625rem 0.75rem;
        border-radius: 12px;
        background: rgba(233, 109, 81, 0.22);
        color: #ffd9cf;
        font-size: 13px;
        line-height: 1.35;
    }
    .refused-error :global(svg) {
        flex: none;
        margin-top: 1px;
    }
    .refused-pill {
        flex: 1 1 0;
        min-width: 0;
        min-height: 44px;
        height: 44px;
        padding: 0 1rem;
        font-size: 14px;
    }
    .refused-spinner {
        width: 3rem;
        height: 3rem;
        border-radius: 50%;
        border: 3px solid rgba(255, 255, 255, 0.12);
        border-top-color: #a78bfa;
        animation: refused-spin 900ms linear infinite;
    }
    @keyframes refused-spin {
        to {
            transform: rotate(360deg);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .refused-spinner {
            animation: none;
        }
    }
</style>
