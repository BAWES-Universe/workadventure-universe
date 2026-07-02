/** @type {import('@capacitor/cli').CapacitorConfig} */

/**
 * BAWES Universe — Capacitor Configuration
 *
 * This shell wraps universe.bawes.net directly.
 * No local game server is needed — the native app is a thin WebView
 * that loads the live deployment, giving users instant updates
 * without going through app store review for every game change.
 *
 * Platform folders (android/, ios/) are added by separate PRs (#4, #5).
 */
const config = {
  appId: "net.bawes.universe",
  appName: "BAWES Universe",

  // Point directly at the live deployment.
  // Capacitor will open this URL in the native WebView on launch.
  server: {
    url: "https://universe.bawes.net",
    cleartext: false, // HTTPS only — no HTTP allowed
    androidScheme: "https", // Ensures cookies/auth work correctly on Android WebView
  },

  // iOS-specific: respect safe areas (notch, home indicator)
  ios: {
    contentInset: "always",
    backgroundColor: "#000000",
  },

  // Android-specific
  android: {
    allowMixedContent: false,
    backgroundColor: "#000000",
  },

  // Plugins used across both platforms
  plugins: {
    // Push notifications — configure with your FCM/APNs keys
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    // SplashScreen — hidden once WebView finishes loading
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: "#000000",
      androidSplashResourceName: "splash",
      showSpinner: false,
    },
  },
};

module.exports = config;
