import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "net.bawes.universe",
  appName: "BAWES Universe",
  server: {
    url: "https://universe.bawes.net",
    cleartext: false,
    androidScheme: "https"
  },
  ios: {
    contentInset: "always"
  },
  android: {
    allowMixedContent: false
  }
};

export default config;
