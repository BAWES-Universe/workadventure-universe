<script lang="ts">
    // One quiet line of explanation under a setting.
    import { IconInfoCircle } from "@wa-icons";
</script>

<p class="bp-note"><IconInfoCircle font-size="14" /><span><slot /></span></p>

<style>
    .bp-note {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin: 0;
        padding: 0 4px;
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
    }
    .bp-note :global(svg) {
        flex: none;
        margin-top: 1px;
    }
</style>
