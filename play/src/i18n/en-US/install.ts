import type { BaseTranslation } from "../i18n-types";

const install: BaseTranslation = {
    // The row in the profile menu, under Settings
    menuRow: "Install app",
    menuRowHint: "Universe on your home screen",
    // The small card that comes now and then
    card: {
        title: "Get the Universe app",
        text: "Opens in one tap, full screen.",
        install: "Install",
        close: "Not now",
    },
    // The note after the browser's own Install
    installed: "Universe is on your home screen",
    guide: {
        close: "Close",
        // Steps, in the words of the browser: bold parts are the buttons to tap
        iphoneSafari: {
            title: "Add Universe to your Home Screen",
            step1: "Tap <b>⋯</b> in your browser's bar. Older iPhones: tap Share.",
            step2: "Tap <b>Share</b>, then <b>Add to Home Screen</b>.",
            step3: "Keep <b>Open as Web App</b> on, then tap <b>Add</b>.",
        },
        ipadSafari: {
            title: "Add Universe to your Home Screen",
            step1: "Tap <b>Share</b> at the top right of Safari.",
            step2: "Scroll down and tap <b>Add to Home Screen</b>.",
            step3: "Keep <b>Open as Web App</b> on, then tap <b>Add</b>.",
        },
        iosChrome: {
            title: "Add Universe to your Home Screen",
            step1: "Tap <b>Share</b> at the top right of Chrome.",
            step2: "Scroll down and tap <b>Add to Home Screen</b>.",
            step3: "Keep <b>Open as Web App</b> on, then tap <b>Add</b>.",
        },
        addToHomeScreen: "Add to Home Screen",
        // Safari cannot tell whether the app is already there, so the sheet says where to find it
        alreadyAdded: "Already added? Open Universe from your Home Screen.",
        openInSafari: {
            title: "Open Universe in Safari to install it",
            text: "This app's own browser can't add apps to your Home Screen. Copy the link, open Safari and paste it.",
            copy: "Copy link",
            copied: "Link copied",
            notNow: "Not now",
        },
        // After the browser's own install window was cancelled (it cannot open twice): one guide per browser, in its own
        // words. Bold parts are the buttons to tap.
        browserMenu: {
            installButton: "Install",
            chromeAndroid: {
                title: "Install Universe from Chrome's menu",
                step1: "Tap <b>⋮</b> next to the address bar.",
                step2: "Tap <b>Install and create shortcut</b>.",
                step2Older: "Older Chrome: Add to home screen",
                step3: "Tap <b>Install</b>.",
            },
            edgeAndroid: {
                title: "Install Universe from Edge's menu",
                step1: "Tap <b>≡</b> in Edge's bar at the bottom.",
                step2: "Tap <b>Add to phone</b>.",
                step3: "Tap <b>Install</b>.",
            },
            samsungAndroid: {
                title: "Install Universe from the browser's menu",
                step1: "Tap <b>≡</b> at the bottom right.",
                step2: "Tap <b>Add page to</b>, then <b>Home screen</b>.",
                step3: "Tap <b>Install</b> (or <b>Add</b>).",
            },
            otherAndroid: {
                title: "Install Universe from your browser's menu",
                step1: "Open your browser's menu.",
                step2: "Tap <b>Install app</b> or <b>Add to home screen</b>.",
                step3: "Tap <b>Install</b>.",
            },
            chromeDesktop: {
                title: "Install Universe from Chrome",
                step1: "Click the <b>Install</b> icon at the right of the address bar.",
                step2: "Click <b>Install</b>.",
                noIcon: "No icon? Click <b>⋮</b>, then <b>Cast, save and share</b>, then <b>Install Universe</b>.",
            },
            edgeDesktop: {
                title: "Install Universe from Edge",
                step1: "Click the <b>App available</b> icon at the right of the address bar.",
                step2: "Click <b>Install</b>.",
                noIcon: "No icon? Click <b>…</b>, then <b>Apps</b>, then <b>Install this site as an app</b>.",
            },
            otherDesktop: {
                title: "Install Universe from your browser",
                step1: "Look for an <b>Install</b> icon at the right of the address bar, or open the browser's menu.",
                step2: "Choose <b>Install</b>.",
            },
        },
        macSafari: {
            title: "Add Universe to your Dock",
            step1: "Click <b>File</b> in the menu bar at the top.",
            step2: "Click <b>Add to Dock</b>, then <b>Add</b>.",
            gotIt: "Got it",
        },
    },
};

export default install;
