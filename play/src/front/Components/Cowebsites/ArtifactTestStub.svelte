<script lang="ts">
    // A stand-in for a part of the window that a test does not look at
    export let name: unknown = undefined;
    export let line: unknown = undefined;
    export let badge: unknown = undefined;
    $: void [name, line, badge];
</script>

<div data-stub="true">
    <slot name="icon" />
    <slot />
</div>
