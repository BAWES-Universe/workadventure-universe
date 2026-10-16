<script lang="ts">
    import type { Readable } from "svelte/store";
    import { readable } from "svelte/store";
    import { defaultColor, defaultWoka } from "../../Connection/Matrix/MatrixChatConnection";
    import ImageWithFallback from "./ImageWithFallback.svelte";

    /**
     * A friend's woka, the size of the People rows'. Friends outside this world have no woka here yet, so they get
     * the default one; `dim` greys out someone offline.
     */
    export let picture: Readable<string | undefined> | undefined = undefined;
    export let color: string | undefined = undefined;
    export let dim = false;
    export let size: "row" | "face" = "row";

    $: pictureStore = picture ?? readable(undefined);
</script>

<div
    class="relative shrink-0 overflow-hidden {size === 'face' ? 'h-11 w-11 rounded-[12px]' : 'h-7 w-7 rounded-md'}"
    class:opacity-50={dim}
    style={`background-color: ${color ?? defaultColor}`}
    aria-hidden="true"
>
    <div class="translate-y-[3px] -translate-x-[3px]">
        <ImageWithFallback
            classes={size === "face" ? "h-[52px] w-[52px]" : "h-8 w-8"}
            src={$pictureStore}
            alt=""
            fallback={defaultWoka}
        />
    </div>
</div>
