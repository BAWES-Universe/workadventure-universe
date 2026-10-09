<script lang="ts" context="module">
    import type { CharacterTextureMessage } from "@workadventure/messages";
    import { CharacterLayerManager } from "../../Phaser/Entity/CharacterLayerManager";

    // Drawing a WOKA takes a moment: each one is drawn once and shared by every picker row and owner card.
    const pictures = new Map<string, Promise<string>>();

    function pictureOf(textures: CharacterTextureMessage[]): Promise<string> {
        const key = textures.map((texture) => `${texture.id}|${texture.url}`).join(",");
        let picture = pictures.get(key);
        if (!picture) {
            picture = CharacterLayerManager.wokaBase64(textures);
            pictures.set(key, picture);
        }
        return picture;
    }
</script>

<script lang="ts">
    import { Color } from "@workadventure/shared-utils";
    import { defaultColor, defaultWoka } from "../../Chat/Connection/Matrix/MatrixChatConnection";
    import ImageWithFallback from "../../Chat/Components/UserList/ImageWithFallback.svelte";

    /**
     * A member's WOKA on their colour, like the People list rows. Members without a WOKA in this world get the
     * default one, as in the People list.
     */
    export let name: string;
    export let textures: CharacterTextureMessage[] = [];

    let src: string | undefined = undefined;
    let drawing = 0;

    function draw(wanted: CharacterTextureMessage[]) {
        const request = ++drawing;
        src = undefined;
        if (wanted.length === 0) return;
        pictureOf(wanted)
            .then((picture) => {
                if (request === drawing) src = picture;
            })
            .catch((error) => console.warn("Unable to draw the member's WOKA", error));
    }

    $: draw(textures);
</script>

<span class="mw" style={`background-color: ${Color.getColorByString(name) ?? defaultColor}`} aria-hidden="true">
    <span class="mw-in">
        <ImageWithFallback classes="mw-img" {src} alt="" fallback={defaultWoka} />
    </span>
</span>

<style>
    .mw {
        position: relative;
        flex: none;
        width: 36px;
        height: 36px;
        overflow: hidden;
        border-radius: 10px;
    }
    .mw-in {
        display: block;
        transform: translate(-4px, 4px);
    }
    .mw :global(.mw-img) {
        width: 42px;
        height: 42px;
        max-width: none;
    }
</style>
