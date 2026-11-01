<script lang="ts">
    /**
     * The status dot on the bottom corner of a woka, cut out of the panel colour so it reads on any woka colour.
     * Put it inside a `relative` box that wraps the woka. "sm" sits on the 32px woka of a chat header, "lg" on the
     * 40px woka of a chat row.
     */
    export let color: string;
    export let size: "sm" | "lg" = "lg";
</script>

<span
    class="pointer-events-none absolute -bottom-0.5 -end-0.5 rounded-full border-solid border-[rgb(25_23_38)] {size ===
    'lg'
        ? 'h-3.5 w-3.5 border-[2.5px]'
        : 'h-3 w-3 border-2'}"
    style:background-color={color}
    data-testid="statusDot"
    aria-hidden="true"
/>
