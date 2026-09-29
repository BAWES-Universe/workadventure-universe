<script lang="ts">
    import { globalMessageVisibleStore } from "../../../Stores/MenuStore";
    import { requestedMegaphoneStore } from "../../../Stores/MegaphoneStore";
    import { LL } from "../../../../i18n/i18n-svelte";
    import ActionBarButton from "../ActionBarButton.svelte";
    import { openGlobalMessageComposer } from "../../GlobalMessage/openGlobalMessageComposer";
    import { IconSpeakerPhone } from "@wa-icons";
</script>

<!-- Same rule as Tools > "Send global message": hidden for people who can't use any broadcast type. -->
{#if $globalMessageVisibleStore}
    <ActionBarButton
        label={$requestedMegaphoneStore ? $LL.actionbar.broadcastLive() : $LL.actionbar.broadcast()}
        dataTestId="broadcast-menu-item"
        on:click={openGlobalMessageComposer}
    >
        <span class="relative flex">
            <IconSpeakerPhone font-size="20" />
            {#if $requestedMegaphoneStore}
                <span class="absolute -top-0.5 -end-0.5 h-2 w-2 rounded-full bg-danger" aria-hidden="true" />
            {/if}
        </span>
    </ActionBarButton>
{/if}
