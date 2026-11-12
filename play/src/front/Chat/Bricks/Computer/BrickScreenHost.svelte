<script lang="ts">
    // Over the chat panel while a Brick's computer screen is open (Watch, game #2000).
    import { brickScreenStore, closeBrickScreen } from "./BrickScreenStore";
    import BrickScreen from "./BrickScreen.svelte";
</script>

{#if $brickScreenStore}
    {#key $brickScreenStore.id}
        <div class="bsh" data-testid="brickScreenHost">
            <BrickScreen brick={$brickScreenStore} onClose={closeBrickScreen} />
        </div>
    {/key}
{/if}

<style>
    .bsh {
        position: absolute;
        inset: 0;
        z-index: 60;
        display: flex;
        flex-direction: column;
        background: linear-gradient(160deg, rgb(31 28 47), rgb(var(--u-ink)));
    }
</style>
