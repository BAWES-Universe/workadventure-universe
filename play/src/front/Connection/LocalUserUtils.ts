import { MAX_USERNAME_LENGTH } from "../Enum/EnvironmentVariable";

export type LayerNames = "woka" | "body" | "eyes" | "hair" | "clothes" | "hat" | "accessory";

export interface CharacterTexture {
    id: string;
    layer: LayerNames;
    url: string;
}

export const maxUserNameLength: number = MAX_USERNAME_LENGTH;

export function isUserNameValid(value: unknown): boolean {
    return typeof value === "string" && value.length > 0 && value.length <= maxUserNameLength && /\S/.test(value);
}

/**
 * Whether a name is sent to the server to be kept on the player's account. Only signed-in players have one: for a guest
 * the play server saves nothing yet still answers "saved", so the name would be kept nowhere and asked for again on
 * every visit. A guest's name stays on the device.
 */
export function shouldSaveNameOnServer(state: {
    hasNameCapability: boolean;
    hasAuthToken: boolean;
    isSignedIn: boolean;
}): boolean {
    return state.hasNameCapability && state.hasAuthToken && state.isSignedIn;
}

export type StepAfterName = "wokaPicker" | "companionPicker" | "camera";

/**
 * The step after the name page when no room was left open (a visit that starts here): the Woka picker only when the
 * player has no valid Woka yet or the load said theirs is refused; a player who already has one goes on to the
 * companion if it is refused, or else the camera page, as upstream WorkAdventure does.
 * `loadNextScene` is what the page load decided (ConnectionManager.initGameConnexion).
 */
export function stepAfterName(state: {
    characterTextureIds: string[] | null;
    loadNextScene: "selectCharacterScene" | "selectCompanionScene" | "gameScene";
}): StepAfterName {
    if (state.loadNextScene === "selectCharacterScene" || !areCharacterTexturesValid(state.characterTextureIds)) {
        return "wokaPicker";
    }
    if (state.loadNextScene === "selectCompanionScene") {
        return "companionPicker";
    }
    return "camera";
}

export function isUserNameTooLong(value: unknown): boolean {
    return typeof value === "string" && value.length > 0 && value.length > maxUserNameLength;
}

export function areCharacterTexturesValid(value: string[] | null): boolean {
    if (!value || !value.length) {
        return false;
    }
    for (const layerName of value) {
        if (layerName.length === 0 || layerName === " ") {
            return false;
        }
    }
    return true;
}
