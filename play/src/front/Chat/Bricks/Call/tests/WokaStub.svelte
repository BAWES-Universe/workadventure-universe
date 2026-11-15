<script lang="ts">
    export let userId: number | string;
    export let placeholderSrc = "";
    export let customWidth = "";
    // A user id of "missing" stands for a Woka the scene cannot find (yet)
    export let resolved = false;
    $: resolved = userId !== "missing";
</script>

<!-- Stands in for the real Woka picture in the tests, which would need a running game scene. -->
<img data-testid="woka-stub" data-user-id={String(userId)} src={placeholderSrc} alt="" style:width={customWidth} />
