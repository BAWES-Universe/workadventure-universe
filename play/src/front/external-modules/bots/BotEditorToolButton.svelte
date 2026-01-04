<script lang="ts">
    import { IconSettings } from "@wa-icons";

    export let onOpenEditor: () => void;
    export let isActive: boolean = false;
</script>

<div class="tool-button relative">
    <button
        class="peer p-3 aspect-square w-12 rounded {isActive ? 'bg-secondary' : 'hover:bg-white/10'}"
        id="BotEditor"
        type="button"
        on:click|preventDefault={onOpenEditor}
    >
        <svelte:component this={IconSettings} font-size="22" />
    </button>
    <div
        class="bg-contrast/90 backdrop-blur-xl text-white tooltip absolute text-nowrap p-2 invisible opacity-0 transition-all peer-hover:visible peer-hover:opacity-100 rounded top-1/2 -translate-y-1/2 right-[130%]"
    >
        Bot Editor
    </div>
</div>
