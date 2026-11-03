export const localUserStore = new Proxy({}, { get: () => () => undefined });
