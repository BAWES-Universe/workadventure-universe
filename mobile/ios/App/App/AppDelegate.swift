import UIKit
import Capacitor

// Application delegate for the BAWES Universe iOS native WebView shell.
// Forwards Orbit OAuth custom scheme redirects (bawes://callback), Universal Links,
// and APNs push notification tokens to the Capacitor runtime bridge.
@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        return true
    }

    // Forward custom URL scheme redirects (such as bawes://callback after Orbit authentication)
    // to Capacitor's ApplicationDelegateProxy so the WebView session receives the auth payload.
    func application(
        _ app: UIApplication,
        open url: URL,
        options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    ) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    // Forward Universal Links and NSUserActivity continuations to the Capacitor bridge
    // to preserve deep-link room routing into universe.bawes.net.
    func application(
        _ application: UIApplication,
        continue userActivity: NSUserActivity,
        restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
    ) -> Bool {
        return ApplicationDelegateProxy.shared.application(
            application,
            continue: userActivity,
            restorationHandler: restorationHandler
        )
    }

    // Broadcast the APNs device token to @capacitor/push-notifications listeners
    // when iOS completes remote notification registration.
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        NotificationCenter.default.post(
            name: .capacitorDidRegisterForRemoteNotifications,
            object: deviceToken
        )
    }

    // Notify @capacitor/push-notifications when APNs registration fails on device.
    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        NotificationCenter.default.post(
            name: .capacitorDidFailToRegisterForRemoteNotifications,
            object: error
        )
    }
}
