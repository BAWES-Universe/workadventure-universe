import Jwt from "jsonwebtoken";

/**
 * Checks a play session token (the "authToken" the front keeps in local
 * storage, signed by play with SECRET_KEY). Sent as a raw Authorization
 * header, like the play API expects it.
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
      typeof payload.identifier === "string"
    );
  } catch (e) {
    return false;
  }
}
