import Jwt from "jsonwebtoken";

/** The SECRET_KEY the test servers are started with: uploads need a play session signed with it. */
export const TEST_SECRET_KEY = "test-secret-key";

/** The header play sends for a signed-in player. */
export function signedInPlayHeaders(): Record<string, string> {
    return {
        Authorization: Jwt.sign(
            {identifier: "user@example.com", accessToken: "oidc-access-token"},
            TEST_SECRET_KEY,
            {expiresIn: "30d"}
        ),
    };
}
