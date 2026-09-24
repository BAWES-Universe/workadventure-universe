<script lang="ts">
    import { chatVisibilityStore } from "../../Stores/ChatStore";
    import { LL } from "../../../i18n/i18n-svelte";
    import { IconX } from "@wa-icons";

    /** Close lives here only when the action bar is hidden because of the chat panel (narrow screens). */
    export let hasCloseChat: boolean;

    function closeChat() {
        chatVisibilityStore.set(false);
    }
</script>

{#if hasCloseChat}
    <button
        class="p-3 hover:bg-white/10 rounded aspect-square w-12 h-12 relative z-50"
        data-testid="closeChatButton"
        aria-label={$LL.chat.closeChat()}
        title={$LL.chat.closeChat()}
        on:click={closeChat}
    >
        <IconX font-size="20" />
    </button>
{/if}
