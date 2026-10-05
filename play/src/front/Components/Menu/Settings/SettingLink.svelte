<script lang="ts">
    import { IconChevronRight } from "@wa-icons";

    /** A row that opens a page inside the settings window (Map credits, Contact, Report a problem). */
    export let label: string;
    export let onClick: () => void;
    export let testId: string | undefined = undefined;
</script>

<button type="button" class="u-set-row u-set-link" data-testid={testId} on:click={onClick}>
    <span class="u-set-text"><span class="u-set-label">{label}</span></span>
    <IconChevronRight class="u-set-chevron" font-size="16" />
</button>
