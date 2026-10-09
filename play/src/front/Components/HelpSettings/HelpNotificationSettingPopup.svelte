<script lang="ts">
    import { fly } from "svelte/transition";
    import { helpNotificationSettingsVisibleStore } from "../../Stores/HelpSettingsStore";
    import { getNavigatorType, isAndroid as isAndroidFct, NavigatorType } from "../../WebRtc/DeviceUtils";
    import { LL } from "../../../i18n/i18n-svelte";
    import { IconInfoCircle } from "@wa-icons";

    let isAndroid = isAndroidFct();
    let isFirefox = getNavigatorType() === NavigatorType.firefox;
    let isChrome = getNavigatorType() === NavigatorType.chrome;

    function refresh() {
        window.location.reload();
    }

    function close() {
        helpNotificationSettingsVisibleStore.set(false);
    }
</script>

<form
    class="helpNotificationSettings z-[600] u-surface text-center rounded-2xl text-white self-center pointer-events-auto flex flex-col m-auto w-full md:w-2/3 xl:w-[380px] text-sm md:text-base absolute top-10 left-0 right-0 overflow-hidden"
    on:submit|preventDefault={close}
    transition:fly={{ y: -50, duration: 500 }}
>
    <section class="mb-0">
        <div class="flex flex-row items-start justify-between">
            <div class="mb-0 text-xl bold border border-solid border-transparent px-4 py-3">
                {$LL.notification.help.title()}
            </div>
            <div class="px-4 mt-4">
                <p class="help-text !text-danger-800">
                    <IconInfoCircle class="mr-2 mb-1 min-w-6" font-size="18" />
                    {$LL.notification.help.permissionDenied()}
                </p>
            </div>
        </div>
        <div class="p-4 italic opacity-50 text-sm leading-4">
            {$LL.notification.help.content()}
        </div>
        <div class="h-72 overflow-hidden opacity-80 saturate-50">
            {#if isFirefox}
                <p class="err">
                    {$LL.notification.help.firefoxContent()}
                </p>
                <img
                    draggable="false"
                    src={$LL.notification.help.screen.firefox()}
                    alt="help camera setup"
                    class="w-full m-auto"
                />
            {:else if isChrome && !isAndroid}
                <img
                    draggable="false"
                    src={$LL.notification.help.screen.chrome()}
                    alt="help camera setup"
                    class="w-full m-auto"
                />
            {/if}
        </div>
    </section>
    <section class="flex row justify-center gap-2 p-4 bg-black/20 border-0 border-t border-solid border-white/[0.08]">
        <button
            type="button"
            class="u-cta-secondary h-11 m-0 px-4 rounded-full w-full justify-center text-sm font-bold"
            on:click|preventDefault={refresh}>{$LL.notification.help.refresh()}</button
        >
        <button
            type="submit"
            class="u-cta h-11 m-0 px-4 rounded-full w-full justify-center text-sm font-bold"
            on:click|preventDefault={close}>{$LL.notification.help.continue()}</button
        >
    </section>
</form>
