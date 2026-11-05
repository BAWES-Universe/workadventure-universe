<script lang="ts">
    import { IconShieldLockFilled } from "../../Components/Icons";

    /** On the top corner instead, where the status dot has the bottom one. */
    export let atTop = false;
</script>

<div class="absolute right-[-4px] h-3 w-3 {atTop ? 'top-[0px]' : 'bottom-[4px]'}">
    <IconShieldLockFilled font-size={10} />
</div>
