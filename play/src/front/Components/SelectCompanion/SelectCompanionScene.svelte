<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import type { CompanionTexture } from "@workadventure/messages";
    import { LL } from "../../../i18n/i18n-svelte";
    import type { Game } from "../../Phaser/Game/Game";
    import type { SelectCompanionScene } from "../../Phaser/Login/SelectCompanionScene";
    import { SelectCompanionSceneName } from "../../Phaser/Login/SelectCompanionScene";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import { companionCollectionsStore } from "../../Stores/SelectCompanionStore";
    import MyWoka from "../Join/MyWoka.svelte";
    import SheetSprite from "../Join/SheetSprite.svelte";
    import { getWokaTextureUrl } from "../Woka/WokaData";
    import { IconBan, IconCheck, IconPaw, IconX } from "@wa-icons";

    export let game: Game;

    // The scene may not exist yet when the screen opens from the menu: look it up when a button needs it
    function companionScene(): SelectCompanionScene | null {
        return (game.scene.getScene(SelectCompanionSceneName) as SelectCompanionScene | null) ?? null;
    }
    // Opened from the game's menu: the round close leads back into the room with the companion unchanged
    const canGoBack = gameManager.canResumeGame;

    $: collections = $companionCollectionsStore ?? [];

    function findCompanion(id: string | null): { collectionIndex: number; texture: CompanionTexture } | undefined {
        if (!id) return undefined;
        for (const [collectionIndex, collection] of collections.entries()) {
            const texture = collection.textures.find((t) => t.id === id);
            if (texture) return { collectionIndex, texture };
        }
        return undefined;
    }

    let collectionIndex = 0;
    let selected: CompanionTexture | null = null;
    let initialised = false;

    // Opens on the companion you have (or None) once the catalog is in; it is no longer cleared when the screen opens
    $: if (!initialised && $companionCollectionsStore) {
        initialised = true;
        const current = findCompanion(localUserStore.getCompanionTextureId());
        collectionIndex = current?.collectionIndex ?? 0;
        selected = current?.texture ?? null;
    }
    let saving = false;

    // The walkers and tiles are drawn at whole multiples of 32px so the pixels stay crisp
    const desktopQuery = window.matchMedia("(min-width: 768px)");
    let isDesktop = desktopQuery.matches;
    $: walkerSize = isDesktop ? 128 : 96;
    $: tileSpriteSize = isDesktop ? 64 : 56;

    $: textures = collections[collectionIndex]?.textures ?? [];
    // None, then the collection's companions: what the arrow keys walk through
    $: choices = [null, ...textures] as (CompanionTexture | null)[];

    function choose(texture: CompanionTexture | null) {
        selected = texture;
    }

    function confirm() {
        const scene = companionScene();
        if (saving || !scene) return;
        saving = true;
        const id = selected?.id;
        if (id) analyticsClient.selectCompanion();
        (id ? scene.selectCompanion(id) : scene.noCompagnion()).catch((e) => {
            console.error(e);
            // Continue works again, so you can retry
            saving = false;
        });
    }

    function back() {
        companionScene()?.closeScene();
    }

    function columns(): number {
        return isDesktop ? 4 : 3;
    }

    let enterPressed = false;

    function onKeyDown(event: KeyboardEvent) {
        if (event.target instanceof HTMLInputElement) return;
        const index = choices.findIndex((choice) => choice?.id === selected?.id);
        let next = index;
        // Your companion is in another collection: the arrows start on this collection's first companion,
        // rather than landing on None
        if (index === -1 && event.key.startsWith("Arrow")) next = Math.min(1, choices.length - 1);
        else if (event.key === "ArrowLeft") next = Math.max(index - 1, 0);
        else if (event.key === "ArrowRight") next = Math.min(index + 1, choices.length - 1);
        else if (event.key === "ArrowUp") next = Math.max(index - columns(), 0);
        else if (event.key === "ArrowDown") next = Math.min(index + columns(), choices.length - 1);
        else if (event.key === "Enter") {
            enterPressed = true;
            return;
        } else if (event.key === "Escape" && canGoBack) {
            back();
            return;
        } else return;
        event.preventDefault();
        if (next !== index) {
            choose(choices[next]);
            document.getElementById(`companion-${choices[next]?.id ?? "none"}`)?.focus();
        }
    }

    function onKeyUp(event: KeyboardEvent) {
        // On key up, so the Enter that saves does not reach the next screen
        if (event.key === "Enter" && enterPressed) {
            enterPressed = false;
            confirm();
        }
    }

    onMount(() => {
        document.addEventListener("keydown", onKeyDown);
        document.addEventListener("keyup", onKeyUp);
    });

    onDestroy(() => {
        document.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("keyup", onKeyUp);
    });
</script>

<div class="fixed inset-0 z-10 companion-backdrop" />

<div
    class="selectCompanionScene pointer-events-auto relative z-30 min-h-dvh flex md:items-center md:justify-center md:p-6"
>
    <div
        class="u-join-card w-full md:w-[1000px] md:max-w-full min-h-dvh md:min-h-0 !rounded-none md:!rounded-[24px] flex flex-col"
    >
        {#if canGoBack}
            <button
                type="button"
                class="u-close u-join-x selectCompanionSceneClose !top-3.5 !right-3 md:!top-4 md:!right-4"
                aria-label={$LL.companion.select.close()}
                title={$LL.companion.select.close()}
                on:click={back}
            >
                <IconX font-size="20" />
            </button>
        {/if}

        <div
            class="flex flex-col md:flex-row gap-3 md:gap-7 px-4 pt-[18px] md:px-7 md:pt-7 pb-28 md:pb-0 flex-1 min-h-0"
        >
            <header class="flex flex-col gap-1 md:hidden {canGoBack ? 'pe-12' : ''}">
                <span class="u-eyebrow">{$LL.companion.select.eyebrow()}</span>
                <h2 class="u-join-title">{$LL.companion.select.heading()}</h2>
            </header>

            <!-- Your WOKA and the companion, walking -->
            <div class="flex flex-col gap-3 md:w-[380px] md:flex-none">
                <div class="u-join-room h-[200px] md:h-[300px]">
                    <div class="u-join-room-wall" />
                    <div class="u-join-room-floor" />
                    <div class="companion-walkers absolute left-1/2 -translate-x-1/2 bottom-[16%] flex items-end">
                        {#if selected}
                            <SheetSprite
                                url={getWokaTextureUrl(selected.url)}
                                size={Math.round(walkerSize * 0.8)}
                                row={2}
                                walking
                            />
                        {/if}
                        <MyWoka size={walkerSize} direction={2} />
                    </div>
                </div>
                <div class="hidden md:flex items-center gap-2.5">
                    <span class="companion-badge">
                        {#if selected}<IconPaw font-size="22" />{:else}<IconBan font-size="22" />{/if}
                    </span>
                    <div class="grid gap-px min-w-0">
                        <b class="text-[17px] text-white truncate">{selected?.name ?? $LL.companion.select.none()}</b>
                        <span class="u-join-hint !text-[13px]"
                            >{selected ? $LL.companion.select.follows() : $LL.companion.select.noneHint()}</span
                        >
                    </div>
                </div>
            </div>

            <div class="flex flex-col gap-2 min-w-0 flex-1 md:pe-10">
                <header class="hidden md:flex flex-col gap-1.5">
                    <span class="u-eyebrow">{$LL.companion.select.eyebrow()}</span>
                    <h2 class="u-join-title">{$LL.companion.select.heading()}</h2>
                </header>
                {#if collections.length > 1}
                    <div class="flex gap-1.5 overflow-x-auto md:mt-1.5 companion-pills" role="tablist">
                        {#each collections as collection, index (collection.name)}
                            <button
                                type="button"
                                role="tab"
                                class="u-join-pill"
                                aria-selected={index === collectionIndex}
                                on:click={() => (collectionIndex = index)}
                            >
                                {collection.name}
                                <b class="companion-count">{collection.textures.length}</b>
                            </button>
                        {/each}
                    </div>
                {/if}
                <div
                    class="grid grid-cols-3 md:grid-cols-4 gap-2 md:mt-3"
                    role="radiogroup"
                    aria-label={$LL.companion.select.heading()}
                >
                    <button
                        type="button"
                        role="radio"
                        id="companion-none"
                        class="u-join-tile selectCompanionSceneFormBack"
                        aria-checked={selected === null}
                        on:click={() => choose(null)}
                    >
                        <span class="flex flex-col items-center gap-0.5 text-white/60 text-xs font-bold">
                            <IconBan font-size="28" />
                            {$LL.companion.select.none()}
                        </span>
                        {#if selected === null}<span class="u-join-tile-check"><IconCheck font-size="12" /></span>{/if}
                    </button>
                    {#each textures as texture (texture.id)}
                        <button
                            type="button"
                            role="radio"
                            id="companion-{texture.id}"
                            class="u-join-tile !pb-[18px]"
                            aria-checked={selected?.id === texture.id}
                            aria-label={texture.name}
                            on:click={() => choose(texture)}
                        >
                            <SheetSprite url={getWokaTextureUrl(texture.url)} size={tileSpriteSize} />
                            <span class="companion-name">{texture.name}</span>
                            {#if selected?.id === texture.id}
                                <span class="u-join-tile-check"><IconCheck font-size="12" /></span>
                            {/if}
                        </button>
                    {/each}
                </div>
            </div>
        </div>

        <footer class="companion-footer">
            <span class="u-join-hint hidden md:inline-flex items-center gap-1 me-auto">
                <span class="u-join-kbd">←</span>
                <span class="u-join-kbd">→</span>
                {$LL.companion.select.browse()} ·
                <span class="u-join-kbd">Enter</span>
                {$LL.companion.select.continueHint()}
            </span>
            <button
                type="button"
                class="u-join-btn u-cta w-full md:w-auto md:min-w-[180px] selectCompanionSceneFormSubmit"
                disabled={saving}
                on:click={confirm}
            >
                <span class="md:hidden"
                    >{selected
                        ? $LL.companion.select.continueWith({ name: selected.name })
                        : $LL.companion.select.continue()}</span
                >
                <span class="hidden md:inline">{$LL.companion.select.continue()}</span>
            </button>
        </footer>
    </div>
</div>

<svelte:window on:resize={() => (isDesktop = desktopQuery.matches)} />

<style lang="scss">
    .companion-backdrop {
        background: radial-gradient(ellipse at 50% 0%, rgba(134, 41, 252, 0.18), transparent 60%), #000;
    }
    /* A plain white icon, as in the menu: no box, so it does not read as a button */
    .companion-badge {
        display: grid;
        place-items: center;
        flex: none;
        width: 1.5rem;
        color: #fff;
    }
    .companion-name {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 6px;
        overflow: hidden;
        padding: 0 4px;
        text-align: center;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.75);
    }
    .companion-count {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.55);
    }
    .u-join-pill[aria-selected="true"] .companion-count {
        color: rgba(255, 255, 255, 0.85);
    }
    .companion-pills {
        scrollbar-width: none;
    }
    .companion-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 0.625rem;
        padding: 1.125rem 1.75rem;
        margin-top: 1rem;
        border-top: 1px solid rgba(255, 255, 255, 0.07);
    }
    @media (max-width: 767px) {
        .companion-footer {
            position: fixed;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 4;
            margin: 0;
            padding: 0.75rem 1rem 1.375rem;
            border-top: 0;
            background: linear-gradient(180deg, rgb(20 18 30 / 0), rgb(20 18 30 / 0.96) 26%);
        }
    }
</style>
