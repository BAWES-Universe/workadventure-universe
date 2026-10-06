// The bridge is framework-independent. This focused config avoids loading the
// Phaser/Svelte application build just to test message and lifecycle behavior.
export default {
  test: {
    environment: "jsdom",
    include: [
      "play/src/front/external-modules/admin-api/{index,orbitBridge,iframeAuth}.test.ts",
    ],
  },
};
