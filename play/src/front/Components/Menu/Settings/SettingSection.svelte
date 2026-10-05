<script lang="ts">
    /** A group of settings under a violet label, like the sections of the profile menu. */
    export let title: string | undefined = undefined;
</script>

<section class="u-set-section">
    {#if title}
        <h3 class="u-set-eyebrow">{title}</h3>
    {/if}
    <slot />
</section>
