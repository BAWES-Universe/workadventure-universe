<script lang="ts">
    // A picture, for the profile panel's test
    export let look: string | null | undefined = undefined;
    // The real ones take more props (size, name, colour): they are read here only so none is reported as unknown
    $: void $$props;
</script>

<span data-testid="pictureStub" data-look={look ?? ""} />
