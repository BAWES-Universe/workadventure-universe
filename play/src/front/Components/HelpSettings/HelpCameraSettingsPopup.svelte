<script lang="ts">
    import { fly } from "svelte/transition";
    import { getNavigatorType, isAndroid as isAndroidFct, NavigatorType } from "../../WebRtc/DeviceUtils";
    import { LL } from "../../../i18n/i18n-svelte";
    import { popupStore } from "../../Stores/PopupStore";
    import { IconCamera, IconInfoCircle, IconMicrophone } from "@wa-icons";

    let isAndroid = isAndroidFct();
    let isFirefox = getNavigatorType() === NavigatorType.firefox;
    let isChrome = getNavigatorType() === NavigatorType.chrome;
    let showDetails = false;

    function allow() {
        showDetails = !showDetails;
    }

    function close() {
        popupStore.removePopup("cameraAccessDenied");
    }
</script>

<!-- Same behaviour as before: Allow shows how to unblock the browser, Continue closes. Restyled in the Universe look. -->
<form
    class="helpCameraSettings camera-help u-glass z-[600] self-center pointer-events-auto flex flex-col w-full md:w-2/3 xl:w-[380px] overflow-hidden rounded-2xl text-white text-sm md:text-base"
    on:submit|preventDefault={close}
    transition:fly={{ y: -50, duration: 500 }}
>
    <section class="flex flex-col items-center gap-3 px-5 pt-5 pb-4 text-center">
        <div class="flex items-center gap-2" aria-hidden="true">
            <span class="camera-help-tile"><IconCamera font-size="20" /></span>
            <span class="camera-help-tile"><IconMicrophone font-size="20" /></span>
        </div>
        <h2 class="u-text-gradient m-0 text-lg font-bold leading-6">{$LL.camera.help.title()}</h2>
        <p class="m-0 text-sm leading-5 text-white/70">{$LL.camera.help.why()}</p>

        {#if showDetails}
            <div class="w-full text-start">
                <p
                    class="m-0 flex items-center gap-2 rounded-xl border border-solid border-danger/40 bg-danger/15 px-3 py-2 text-sm font-semibold text-white"
                >
                    <IconInfoCircle class="shrink-0 text-danger-400" font-size="18" />
                    {$LL.camera.help.permissionDenied()}
                </p>
                <p class="m-0 mt-2 text-xs leading-5 text-white/65">{$LL.camera.help.content()}</p>
                {#if isFirefox}
                    <p class="m-0 mt-1 text-xs leading-5 text-white/65">{$LL.camera.help.firefoxContent()}</p>
                {/if}
                {#if isFirefox || (isChrome && !isAndroid)}
                    <div class="mt-3 max-h-60 overflow-hidden rounded-xl border border-solid border-white/10">
                        <img
                            draggable="false"
                            src={isFirefox ? $LL.camera.help.screen.firefox() : $LL.camera.help.screen.chrome()}
                            alt="help camera setup"
                            class="block w-full"
                        />
                    </div>
                {/if}
            </div>
        {/if}
    </section>
    <section class="flex flex-col gap-2 px-5 pb-5">
        <button
            type="button"
            class="u-cta m-0 flex h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-bold"
            on:click|preventDefault={allow}>{$LL.camera.help.allow()}</button
        >
        <button
            type="submit"
            class="m-0 flex h-10 w-full items-center justify-center rounded-xl bg-transparent px-4 text-sm font-semibold text-white/70 hover:bg-white/10 hover:text-white"
            on:click|preventDefault={close}>{$LL.camera.help.continue()}</button
        >
    </section>
</form>

<style>
    .camera-help {
        background: linear-gradient(160deg, rgba(38, 52, 82, 0.94), rgba(27, 42, 65, 0.96));
        box-shadow: 0 24px 60px -20px rgba(0, 0, 0, 0.7), 0 0 32px -14px rgba(134, 41, 252, 0.5);
    }
    .camera-help-tile {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2.75rem;
        height: 2.75rem;
        border-radius: 0.875rem;
        color: #fff;
        background: linear-gradient(135deg, #8629fc, #4156f6);
        box-shadow: 0 8px 20px -8px rgba(134, 41, 252, 0.8);
    }
</style>
