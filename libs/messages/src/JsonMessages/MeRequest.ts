import {z} from "zod";

export const MeRequest = z.object({
    token: z.string(),
    playUri: z.string(),
    "localStorageCharacterTextureIds[]": z.union([z.string(), z.array(z.string())]).optional(),
    localStorageCompanionTextureId: z.string().optional(),
    chatID: z.string().optional(),
    // The name this browser has saved from the name screen. Only a guest's is passed on to Orbit.
    name: z.string().optional(),
    // "true" renews the OIDC access token through the refresh token even when the provider still accepts it,
    // for a caller whose access token was refused elsewhere (Orbit's sign-in).
    refresh: z.literal("true").optional(),
    // The guest token this device kept aside before signing in, sent once right after sign-in. The pusher checks it is
    // a guest token it signed; only the guest id in it goes on to Orbit.
    guestToken: z.string().optional(),
});

export type MeRequest = z.infer<typeof MeRequest>;
