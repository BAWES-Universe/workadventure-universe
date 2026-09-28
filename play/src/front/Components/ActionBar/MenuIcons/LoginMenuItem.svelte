<script lang="ts">
    import ActionBarButton from "../ActionBarButton.svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import { goToLogin } from "./goToLogin";
    import { IconUserCircle } from "@wa-icons";

    export let first: boolean | undefined = undefined;
    export let last: boolean | undefined = undefined;
    export let classList: string | undefined = undefined;
    export let bgColor: string | undefined = undefined;
</script>

<ActionBarButton
    label={$LL.actionbar.login()}
    state="active"
    hideIconInActionBar={true}
    dataTestId="actionBarLogin"
    boldLabel={true}
    on:click={goToLogin}
    {first}
    {last}
    {classList}
    {bgColor}
>
    <IconUserCircle />
</ActionBarButton>
