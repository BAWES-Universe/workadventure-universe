<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import {
        backgroundConfigStore,
        backgroundEffectStartingStore,
        backgroundPresets,
        backgroundProcessingSupportedStore,
    } from "../../Stores/BackgroundTransformStore";
    import { cameraNoEnergySavingStore, localStreamStore, requestedCameraState } from "../../Stores/MediaStore";
    import { srcObject } from "../Video/utils";
    import { IconAlertTriangle, IconBan, IconCheck, IconEyeOff, IconVideoOff } from "@wa-icons";

    // Same strengths as upstream WorkAdventure. "px" only blurs the sample thumbnail so the three tiles look different.
    const blurOptions = [
        { key: "blurLight", amount: 10, px: 1.5 },
        { key: "blurMedium", amount: 25, px: 4 },
        { key: "blurStrong", amount: 50, px: 8 },
    ] as const;

    // Keep the camera awake while people choose an effect, as the old background popup did.
    onMount(() => cameraNoEnergySavingStore.set(true));
    onDestroy(() => cameraNoEnergySavingStore.set(false));

    // Amounts saved by the old slider (10 to 50) show as the closest of the three tiles.
    $: selectedBlurAmount =
        $backgroundConfigStore.mode === "blur"
            ? blurOptions.reduce((closest, option) =>
                  Math.abs(option.amount - ($backgroundConfigStore.blurAmount ?? 0)) <
                  Math.abs(closest.amount - ($backgroundConfigStore.blurAmount ?? 0))
                      ? option
                      : closest
              ).amount
            : undefined;
    $: selectedImage = $backgroundConfigStore.mode === "image" ? $backgroundConfigStore.backgroundImage : undefined;
    $: starting = $backgroundEffectStartingStore && $backgroundConfigStore.mode !== "none";
    // The preview only shows what is already on: it never turns the camera on, so nothing is sent that wasn't before.
    $: previewStream =
        $requestedCameraState &&
        $localStreamStore.type === "success" &&
        $localStreamStore.stream?.getVideoTracks().length
            ? $localStreamStore.stream
            : undefined;

    function chooseNone() {
        backgroundConfigStore.setMode("none");
    }

    function chooseBlur(amount: number) {
        backgroundConfigStore.setBlurAmount(amount);
        backgroundConfigStore.setMode("blur");
    }

    function chooseImage(url: string) {
        backgroundConfigStore.setBackgroundImage(url);
    }
</script>

<div class="preview" data-testid="background-preview">
    {#if previewStream}
        <video class="cam" class:dim={starting} use:srcObject={previewStream} autoplay muted playsinline />
        {#if starting}
            <div class="busy">
                <span class="spin" />
                {$backgroundConfigStore.mode === "image"
                    ? $LL.camera.backgroundEffects.startingImage()
                    : $LL.camera.backgroundEffects.startingBlur()}
            </div>
        {/if}
        <div class="chip"><IconEyeOff font-size="12" />{$LL.camera.backgroundEffects.onlyYou()}</div>
    {:else}
        <div class="cam-off">
            <IconVideoOff font-size="22" class="text-white/50" />
            <span>{$LL.camera.backgroundEffects.cameraOff()}</span>
        </div>
    {/if}
</div>

{#if !$backgroundProcessingSupportedStore}
    <div class="note" data-testid="background-effects-unsupported">
        <div class="note-title">
            <IconAlertTriangle font-size="16" class="text-[#e9c74c] shrink-0" />
            {$LL.camera.backgroundEffects.unsupportedTitle()}
        </div>
        {$LL.camera.backgroundEffects.unsupportedBody()}
    </div>
{:else}
    <div class="u-eyebrow px-2 py-1.5">{$LL.camera.backgroundEffects.blurSection()}</div>
    <div class="fx">
        <button
            type="button"
            class="opt"
            class:on={$backgroundConfigStore.mode === "none"}
            aria-pressed={$backgroundConfigStore.mode === "none"}
            on:click={chooseNone}
        >
            <span class="th" class:sel={$backgroundConfigStore.mode === "none"}><IconBan font-size="20" /></span>
            {$LL.camera.backgroundEffects.noEffect()}
        </button>
        {#each blurOptions as option (option.key)}
            {@const selected = selectedBlurAmount === option.amount}
            <button
                type="button"
                class="opt"
                class:on={selected}
                aria-pressed={selected}
                on:click={() => chooseBlur(option.amount)}
            >
                <span class="th" class:sel={selected}>
                    <img
                        src="./static/images/background/thumbnail/settingBackgroundEffect.jpeg"
                        alt=""
                        style="filter: blur({option.px}px)"
                    />
                    {#if selected && starting}<span class="mini"><span class="spin small" /></span>{/if}
                </span>
                {$LL.camera.backgroundEffects[option.key]()}
            </button>
        {/each}
    </div>
    <div class="u-eyebrow px-2 py-1.5">{$LL.camera.backgroundEffects.imagesSection()}</div>
    <div class="imgs">
        {#each backgroundPresets.images as preset (preset.url)}
            {@const selected = selectedImage === preset.url}
            <button
                type="button"
                class="th"
                class:sel={selected}
                title={preset.name}
                aria-label={preset.name}
                aria-pressed={selected}
                on:click={() => chooseImage(preset.url)}
            >
                <img src={preset.thumbnail} alt="" />
                {#if selected && starting}
                    <span class="mini"><span class="spin small" /></span>
                {:else if selected}
                    <span class="badge"><IconCheck font-size="12" /></span>
                {/if}
            </button>
        {/each}
    </div>
{/if}

<style>
    .preview {
        position: relative;
        flex: none;
        aspect-ratio: 16 / 9;
        margin: 0 0.25rem 0.375rem;
        border-radius: 1rem;
        overflow: hidden;
        background: #0d0b16;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
    }
    .cam {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        transform: scaleX(-1);
    }
    .cam.dim {
        filter: saturate(0.6) brightness(0.75);
    }
    .cam-off {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 0 1rem;
        text-align: center;
        font-size: 12px;
        line-height: 1.3;
        color: rgba(255, 255, 255, 0.7);
    }
    .chip {
        position: absolute;
        left: 6px;
        bottom: 6px;
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 3px 9px 3px 7px;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 700;
        background: rgba(20, 18, 30, 0.72);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
    }
    .busy {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 700;
    }
    .spin {
        width: 22px;
        height: 22px;
        border-radius: 9999px;
        border: 2.5px solid rgba(255, 255, 255, 0.2);
        border-top-color: #c4b5fd;
        animation: spin 0.9s linear infinite;
    }
    .spin.small {
        width: 16px;
        height: 16px;
        border-width: 2px;
    }
    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .spin {
            animation-duration: 2.4s;
        }
    }
    .fx {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 6px;
        padding: 0 0.25rem 0.25rem;
    }
    .opt {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        color: rgba(255, 255, 255, 0.7);
        padding: 0;
        cursor: pointer;
    }
    .opt.on {
        color: #fff;
        font-weight: 700;
    }
    .th {
        position: relative;
        display: grid;
        place-items: center;
        width: 100%;
        aspect-ratio: 1;
        padding: 0;
        border-radius: 0.75rem;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.06);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.8);
        cursor: pointer;
        transition: box-shadow 150ms ease;
    }
    .th img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }
    .opt:hover .th:not(.sel),
    button.th:hover:not(.sel) {
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
    }
    .opt:focus-visible,
    button.th:focus-visible {
        outline: 2px solid rgba(196, 181, 253, 0.9);
        outline-offset: 2px;
        border-radius: 0.75rem;
    }
    .th.sel {
        box-shadow: 0 0 0 2px #a78bfa, 0 0 18px -4px rgba(134, 41, 252, 0.9);
    }
    .badge {
        position: absolute;
        right: 4px;
        top: 4px;
        display: grid;
        place-items: center;
        width: 18px;
        height: 18px;
        border-radius: 9999px;
        color: #fff;
        background: linear-gradient(135deg, #8629fc, #4156f6);
        box-shadow: 0 0 0 2px rgba(20, 18, 30, 0.8);
    }
    .mini {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        background: rgba(20, 18, 30, 0.5);
    }
    .imgs {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 6px;
        padding: 0 0.25rem 0.375rem;
    }
    .note {
        margin: 0.125rem 0.25rem 0.375rem;
        padding: 0.75rem;
        border-radius: 1rem;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        font-size: 13px;
        line-height: 1.35;
        color: rgba(255, 255, 255, 0.78);
    }
    .note-title {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-bottom: 6px;
        font-size: 14px;
        font-weight: 700;
        color: #fff;
    }
</style>
