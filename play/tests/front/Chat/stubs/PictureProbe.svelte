<script lang="ts">
    import type { Readable } from "svelte/store";

    /** Stands in for the Woka avatar: says which picture store it was given, and the colour. */
    export let picture: Readable<string | undefined> | undefined = undefined;
    export let color: string | undefined = undefined;
    $: pictureStore = picture;
</script>

<span data-testid="avatar" data-colour={color}>{$pictureStore ?? "default"}</span>
