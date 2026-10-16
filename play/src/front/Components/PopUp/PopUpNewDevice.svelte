<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import type { NewDeviceOffer } from "../../Utils/NewMediaDevices";
    import { ignoreKeysForOffer } from "../../Utils/NewMediaDevices";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import { deviceListOpenRequestStore, newDeviceTagsStore, useMediaDevice } from "../../Stores/NewDeviceStore";
    import { IconCamera, IconCheck, IconHeadphonesOutline, IconMicrophoneOn, IconUnMute, IconX } from "@wa-icons";

    export let offer: NewDeviceOffer;

    const dispatch = createEventDispatcher<{ close: void }>();

    // One tick per kind the device has, in the order the device list shows them. A device with a single kind needs
    // no tick: Switch says it all.
    const KIND_ORDER: MediaDeviceKind[] = ["videoinput", "audioinput", "audiooutput"];
    $: kinds = KIND_ORDER.filter((kind) => offer.devices.some((device) => device.kind === kind));
    let unticked = new Set<MediaDeviceKind>();
    // A newer offer replaces this card in place: it starts again with every kind ticked.
    let tickedFor: NewDeviceOffer | undefined;
    $: if (offer !== tickedFor) {
        tickedFor = offer;
        unticked = new Set();
    }
    $: ticked = kinds.filter((kind) => !unticked.has(kind));

    function toggle(kind: MediaDeviceKind) {
        if (unticked.has(kind)) {
            unticked.delete(kind);
        } else {
            unticked.add(kind);
        }
        unticked = unticked;
    }

    function kindTitle(kind: MediaDeviceKind): string {
        switch (kind) {
            case "videoinput":
                return $LL.camera.newDevice.camera();
            case "audioinput":
                return $LL.camera.newDevice.microphone();
            default:
                return $LL.camera.newDevice.speaker();
        }
    }

    function kindDesc(kind: MediaDeviceKind): string {
        switch (kind) {
            case "videoinput":
                return $LL.camera.newDevice.toBeSeen();
            case "audioinput":
                return $LL.camera.newDevice.toTalk();
            default:
                return $LL.camera.newDevice.toListen();
        }
    }

    function listOf(parts: string[]): string {
        if (parts.length < 2) return parts.join("");
        return $LL.camera.newDevice.list({ items: parts.slice(0, -1).join(", "), last: parts[parts.length - 1] });
    }

    $: eyebrow =
        offer.type === "one"
            ? $LL.camera.newDevice.detected()
            : offer.audioOnly
            ? $LL.camera.newDevice.newAudioDevices()
            : $LL.camera.newDevice.newDevices();
    $: title =
        offer.type === "one"
            ? offer.label
            : offer.name !== undefined
            ? $LL.camera.newDevice.added({ name: offer.name, count: offer.parts.length })
            : $LL.camera.newDevice.count({ count: offer.parts.length });
    $: body =
        offer.type === "one"
            ? $LL.camera.newDevice.useIt()
            : $LL.camera.newDevice.useOne({ parts: listOf(offer.parts) });
    $: dontAsk =
        offer.type === "one"
            ? $LL.camera.newDevice.dontAskDevice()
            : offer.name !== undefined
            ? $LL.camera.newDevice.dontAskAbout({ name: offer.name })
            : $LL.camera.newDevice.dontAskThese();
    $: hasCamera = offer.devices.some((device) => device.kind === "videoinput");
    $: hasMicrophone = offer.devices.some((device) => device.kind === "audioinput");
    $: hasSpeaker = offer.devices.some((device) => device.kind === "audiooutput");

    function close() {
        dispatch("close");
    }

    function switchToDevice() {
        if (ticked.length === 0) return;
        for (const device of offer.devices) {
            if (ticked.includes(device.kind)) {
                useMediaDevice(device);
            }
        }
        close();
    }

    function chooseDevice() {
        newDeviceTagsStore.set(new Set(offer.devices.map((device) => device.deviceId)));
        deviceListOpenRequestStore.set(true);
        close();
    }

    function primary() {
        if (offer.type === "one") {
            switchToDevice();
        } else {
            chooseDevice();
        }
    }

    function dontAskAgain() {
        localUserStore.addIgnoredNewMediaDevices(ignoreKeysForOffer(offer));
        close();
    }

    function isTyping(target: EventTarget | null): boolean {
        return (
            target instanceof HTMLElement &&
            (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
        );
    }

    // Enter means Switch (or Choose device) and Esc means Not now, unless you are typing somewhere. Caught before the
    // game sees them, so Enter does not also open the chat.
    function onKeyDown(event: KeyboardEvent) {
        if (event.isComposing || isTyping(event.target)) return;
        if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            primary();
        } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
        }
    }

    onMount(() => window.addEventListener("keydown", onKeyDown, true));
    onDestroy(() => window.removeEventListener("keydown", onKeyDown, true));
</script>

<div class="flex w-full justify-center text-white">
    <div
        class="new-device u-surface pointer-events-auto relative w-full mobile:mx-1 sm:w-[440px] overflow-hidden rounded-2xl text-start"
        role="dialog"
        aria-labelledby="new-device-title"
        data-testid="new-device-card"
    >
        <button
            type="button"
            class="u-close absolute top-2 end-2"
            aria-label={$LL.camera.newDevice.close()}
            data-testid="new-device-close"
            on:click={close}
        >
            <IconX font-size="20" />
        </button>

        <div class="flex items-start gap-3.5 ps-4 pe-14 pt-4 pb-3">
            <!-- A plain white glyph, no box behind it, like the other icons in the game. -->
            <span class="new-device-icon" aria-hidden="true">
                {#if offer.type === "several"}
                    {#if hasCamera && !hasMicrophone && !hasSpeaker}
                        <IconCamera font-size="28" />
                    {:else}
                        <IconUnMute font-size="28" />
                    {/if}
                {:else if hasCamera}
                    <IconCamera font-size="28" />
                {:else if hasMicrophone && !hasSpeaker}
                    <IconMicrophoneOn font-size="28" />
                {:else if hasSpeaker && !hasMicrophone}
                    <IconUnMute font-size="28" />
                {:else}
                    <IconHeadphonesOutline font-size="28" />
                {/if}
            </span>
            <div class="min-w-0">
                <div class="u-eyebrow">{eyebrow}</div>
                <p id="new-device-title" class="new-device-title m-0 mt-1 text-lg font-bold leading-6 break-words">
                    {title}
                </p>
                <p class="new-device-muted m-0 mt-0.5 text-sm leading-5">{body}</p>
            </div>
        </div>

        {#if offer.type === "one" && kinds.length > 1}
            <div class="grid gap-2 px-4 pb-3" style="grid-template-columns: repeat({kinds.length}, minmax(0, 1fr));">
                {#each kinds as kind (kind)}
                    <button
                        type="button"
                        role="checkbox"
                        aria-checked={ticked.includes(kind)}
                        class="u-option new-device-tick"
                        class:u-selected={ticked.includes(kind)}
                        data-testid="new-device-tick-{kind}"
                        on:click={() => toggle(kind)}
                    >
                        <span class="new-device-box" aria-hidden="true">
                            {#if ticked.includes(kind)}<IconCheck font-size="14" stroke={3} />{/if}
                        </span>
                        <span class="u-option-text">
                            <span class="block text-[15px] font-semibold leading-5">{kindTitle(kind)}</span>
                            <span class="new-device-muted block text-xs leading-4">{kindDesc(kind)}</span>
                        </span>
                    </button>
                {/each}
            </div>
        {/if}

        <div class="flex gap-2 px-4 mobile:flex-col-reverse">
            <button
                type="button"
                class="u-cta-secondary m-0 flex h-11 flex-1 mobile:flex-none items-center justify-center gap-2 rounded-full px-4 text-sm font-bold"
                data-testid="new-device-not-now"
                on:click={close}
            >
                {$LL.camera.newDevice.notNow()}
                <span class="u-join-kbd mobile:hidden" aria-hidden="true">Esc</span>
            </button>
            <button
                type="button"
                class="u-cta m-0 flex h-11 flex-1 mobile:flex-none items-center justify-center gap-2 rounded-full px-4 text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid={offer.type === "one" ? "new-device-switch" : "new-device-choose"}
                disabled={offer.type === "one" && ticked.length === 0}
                on:click|stopPropagation={primary}
            >
                {offer.type === "one" ? $LL.camera.newDevice.switch() : $LL.camera.newDevice.chooseDevice()}
                <span class="new-device-kbd u-join-kbd mobile:hidden" aria-hidden="true">Enter</span>
            </button>
        </div>

        <div class="flex justify-center px-4 pb-1.5 pt-1">
            <button
                type="button"
                class="new-device-dont-ask m-0 flex h-11 items-center px-3 text-[13px]"
                data-testid="new-device-dont-ask"
                on:click={dontAskAgain}>{dontAsk}</button
            >
        </div>
    </div>
</div>

<style>
    .new-device button {
        font-family: inherit;
    }
    .new-device-icon {
        flex: none;
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        margin-top: 2px;
        color: #fff;
    }
    .new-device-title {
        color: #e9c74c;
        text-transform: none;
    }
    .new-device-muted {
        color: #b9b3d1;
    }
    .new-device-tick {
        gap: 10px;
        padding: 10px 12px;
        min-height: 3.25rem;
    }
    /* The tick: an empty rounded square, the gradient with a white check once ticked. */
    .new-device-box {
        flex: none;
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
        border-radius: 6px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        color: #fff;
    }
    .new-device-tick.u-selected .new-device-box {
        border-color: transparent;
        background: linear-gradient(135deg, #8629fc, #4156f6);
    }
    /* The key chip on the gradient button stays readable. */
    .new-device-kbd {
        background: rgba(255, 255, 255, 0.18);
        color: #fff;
    }
    .new-device-dont-ask {
        color: rgba(255, 255, 255, 0.6);
        background: transparent;
        border-radius: 9999px;
        cursor: pointer;
    }
    .new-device-dont-ask:hover {
        color: #fff;
    }
    .new-device-dont-ask:focus-visible {
        outline: 2px solid rgba(196, 181, 253, 0.9);
        outline-offset: -2px;
    }
</style>
