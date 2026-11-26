<script lang="ts">
    // The visit card, for the profile panel's test: it only shows what it was given
    export let brick: { id: string };
    export let framed = false;
    export let showOff = false;
</script>

<div
    data-testid="brickVisitCardStub"
    data-brick={brick.id}
    data-framed={String(framed)}
    data-show-off={String(showOff)}
/>
