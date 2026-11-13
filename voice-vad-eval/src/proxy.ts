// Through this machine's outbound HTTPS proxy, when it has one, for connections to Soniox only (the worker in production
// connects directly). Imported for its effect: ws's https.request gets an agent that tunnels with CONNECT.
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
if (proxy) {
    const { hostname, port } = new URL(proxy);
    class ConnectAgent extends https.Agent {
        createConnection(options: Record<string, unknown>, done: (err: Error | null, socket?: net.Socket) => void): undefined {
            const host = String(options.host ?? options.hostname);
            const targetPort = Number(options.port ?? 443);
            const raw = net.connect(Number(port), hostname, () => raw.write(`CONNECT ${host}:${targetPort} HTTP/1.1\r\nHost: ${host}:${targetPort}\r\n\r\n`));
            let head = '';
            const onData = (chunk: Buffer) => {
                head += chunk.toString('latin1');
                if (!head.includes('\r\n\r\n')) return;
                raw.off('data', onData);
                if (!/^HTTP\/1\.[01] 200/.test(head)) return done(new Error(`proxy refused: ${head.split('\r\n')[0]}`));
                const secure = tls.connect({ socket: raw, servername: host, ALPNProtocols: ['http/1.1'] });
                secure.once('secureConnect', () => done(null, secure));
                secure.once('error', (e) => done(e));
            };
            raw.on('data', onData);
            raw.once('error', (e) => done(e));
            return undefined;
        }
    }
    const agent = new ConnectAgent({ keepAlive: false });
    const original = https.request;
    (https as unknown as { request: typeof https.request }).request = ((...args: unknown[]) => {
        const options = args[0] as Record<string, unknown> | undefined;
        if (options && typeof options === 'object' && /(^|\.)soniox\.com$/.test(String(options.hostname ?? options.host ?? ''))) {
            options.agent = agent;
            delete options.createConnection;
        }
        return (original as (...a: unknown[]) => ReturnType<typeof https.request>).apply(https, args);
    }) as typeof https.request;
}

