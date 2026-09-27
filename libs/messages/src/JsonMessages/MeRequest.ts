import {z} from "zod";

export const MeRequest = z.object({
    token: z.string(),
    playUri: z.string(),
    "localStorageCharacterTextureIds[]": z.union([z.string(), z.array(z.string())]).optional(),
    localStorageCompanionTextureId: z.string().optional(),
    chatID: z.string().optional(),
    // "true" renews the OIDC access token through the refresh token even when the provider still accepts it,
    // for a caller whose access token was refused elsewhere (Orbit's sign-in).
    refresh: z.literal("true").optional(),
});

export type MeRequest = z.infer<typeof MeRequest>;
