<script lang="ts">
    /**
     * A settings row with a switch on the right. The whole row is the label, so a tap anywhere on it flips the
     * switch. On is the brand gradient, off a soft white.
     */
    export let id: string;
    export let label: string;
    export let hint: string | undefined = undefined;
    export let checked = false;
    export let onChange: () => void = () => {};
</script>

<label class="u-set-row u-set-switch-row" for={id}>
    <span class="u-set-text">
        <span class="u-set-label">{label}</span>
        {#if hint}
            <span class="u-set-hint">{hint}</span>
        {/if}
    </span>
    <input {id} type="checkbox" role="switch" class="u-set-switch" data-testid={id} bind:checked on:change={onChange} />
</label>
