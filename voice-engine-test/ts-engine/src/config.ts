// Process-wide settings filled by main.ts
export const cfg = { signalingUrl: 'http://127.0.0.1:8700' };
export const stunUrl = () => `stun:127.0.0.1:${Number(new URL(cfg.signalingUrl).port) + 1000}`;
