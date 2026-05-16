import { Capacitor } from "@capacitor/core";
import { PushNotifications, type Token } from "@capacitor/push-notifications";

export type NativePushRegistrationReason =
  | "native-platform-unavailable"
  | "permission-denied"
  | "registration-listener-failed";

export interface NativePushRegistrationOptions {
  apiBaseUrl: string;
  deviceId?: string;
  roomId?: string;
  userId?: string;
}

export interface NativePushRegistrationResult {
  registered: boolean;
  reason?: NativePushRegistrationReason;
}

export async function registerNativePushNotifications(
  options: NativePushRegistrationOptions
): Promise<NativePushRegistrationResult> {
  const platform = Capacitor.getPlatform();

  if (platform !== "android" && platform !== "ios") {
    return { registered: false, reason: "native-platform-unavailable" };
  }

  const permission = await PushNotifications.requestPermissions();

  if (permission.receive !== "granted") {
    return { registered: false, reason: "permission-denied" };
  }

  try {
    await PushNotifications.addListener(
      "registration",
      async (token: Token): Promise<void> => {
        await postNativePushToken(options, token.value, platform);
      }
    );
  } catch {
    return { registered: false, reason: "registration-listener-failed" };
  }

  await PushNotifications.register();

  return { registered: true };
}

export async function postNativePushToken(
  options: NativePushRegistrationOptions,
  token: string,
  platform: "android" | "ios"
): Promise<void> {
  const response = await fetch(
    new URL("/api/push/register", options.apiBaseUrl).toString(),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        platform,
        token,
        userId: options.userId,
        roomId: options.roomId,
        deviceId: options.deviceId,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to register native push token: ${response.status}`);
  }
}
