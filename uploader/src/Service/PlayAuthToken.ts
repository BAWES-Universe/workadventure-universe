import Jwt from "jsonwebtoken";

/**
 * Checks a play session token (the "authToken" the front keeps in local
 * storage, signed by play with SECRET_KEY). Sent as a raw Authorization
 * header, like the play API expects it.
 *
 * Only signed-in players pass: play gives guests a session token too, but
 * only a sign-in through OpenID puts an access token in it (the same test
 * play uses for "isLogged").
 */
export function isValidPlayAuthToken(
  token: string | undefined,
  secretKey: string
): boolean {
  if (!token) {
    return false;
  }
  try {
    const payload = Jwt.verify(token, secretKey, { algorithms: ["HS256"] });
    return (
      typeof payload === "object" &&
      payload !== null &&
      typeof payload.identifier === "string" &&
      typeof payload.accessToken === "string" &&
      payload.accessToken !== ""
    );
  } catch (e) {
    return false;
  }
}

/**
 * Checks that a token is a real play session: signed by play with SECRET_KEY and not expired. Guests pass, because play
 * gives them a session too; somebody who never opened the game cannot make one. Used for chat file uploads.
 */
export function isValidPlayGameSession(
  token: string | undefined,
  secretKey: string
): boolean {
  if (!token) {
    return false;
  }
  try {
    const payload = Jwt.verify(token, secretKey, { algorithms: ["HS256"] });
    return (
      typeof payload === "object" &&
      payload !== null &&
      typeof payload.identifier === "string" &&
      payload.identifier !== ""
    );
  } catch (e) {
    return false;
  }
}
