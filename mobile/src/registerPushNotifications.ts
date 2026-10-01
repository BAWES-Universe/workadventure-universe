import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import {
  PushNotifications,
  type RegistrationError,
  type Token,
} from "@capacitor/push-notifications";

export type NativePushRegistrationReason =
  | "native-platform-unavailable"
  | "permission-denied"
  | "registration-failed"
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

  let registrationListener: PluginListenerHandle | undefined;
  let registrationErrorListener: PluginListenerHandle | undefined;

  const removeListeners = async (): Promise<void> => {
    await registrationListener?.remove();
    await registrationErrorListener?.remove();
  };

  let resolveRegistration: (
    result: NativePushRegistrationResult
  ) => void = () => undefined;
  let settled = false;

  const registrationResult = new Promise<NativePushRegistrationResult>(
    (resolve) => {
      resolveRegistration = resolve;
    }
  );

  const settleRegistration = async (
    result: NativePushRegistrationResult
  ): Promise<void> => {
    if (settled) {
      return;
    }

    settled = true;
    await removeListeners();
    resolveRegistration(result);
  };

  try {
    registrationListener = await PushNotifications.addListener(
      "registration",
      async (token: Token): Promise<void> => {
        try {
          await postNativePushToken(options, token.value, platform);
          await settleRegistration({ registered: true });
        } catch (error) {
          console.error("Failed to register native push token", error);
          await settleRegistration({
            registered: false,
            reason: "registration-failed",
          });
        }
      }
    );
    registrationErrorListener = await PushNotifications.addListener(
      "registrationError",
      async (error: RegistrationError): Promise<void> => {
        console.error("Native push registration failed", error);
        await settleRegistration({
          registered: false,
          reason: "registration-failed",
        });
      }
    );
    await PushNotifications.register();
  } catch (error) {
    console.error("Failed to start native push registration", error);
    await removeListeners();
    return { registered: false, reason: "registration-listener-failed" };
  }

  return registrationResult;
}

export async function postNativePushToken(
  options: NativePushRegistrationOptions,
  token: string,
  platform: "android" | "ios"
): Promise<void> {
  const response = await fetch(
    buildPushApiUrl("/api/push/register", options.apiBaseUrl),
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
    const body = await response.text();
    throw new Error(
      `Failed to register native push token: ${response.status} ${body}`
    );
  }
}

function buildPushApiUrl(path: string, apiBaseUrl: string): string {
  const normalizedBase = apiBaseUrl.endsWith("/")
    ? apiBaseUrl
    : `${apiBaseUrl}/`;
  const normalizedPath = path.replace(/^\/+/, "");

  return new URL(normalizedPath, normalizedBase).toString();
}
