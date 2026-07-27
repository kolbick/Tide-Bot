import { createConnection, createServer } from 'node:net';

// The application under test and the fake model service sit on an `internal`
// Compose network so they have no route off the host. Docker refuses to publish
// ports from an internal network, so this fixed forwarder is the only member of
// both that network and the publishable one. It carries no credentials, reads no
// configuration, and can only reach the two hard-coded isolated upstreams below.
const forwards = [
	{ listenPort: 8080, host: 'tide-bot', port: 8080 },
	{ listenPort: 8081, host: 'fake-openai', port: 8081 }
];

const servers = forwards.map(({ listenPort, host, port }) => {
	const server = createServer((downstream) => {
		const upstream = createConnection({ host, port });
		const destroyBoth = () => {
			downstream.destroy();
			upstream.destroy();
		};
		// Aborts must propagate in both directions: the slow-stream case proves
		// the fixture observes the browser hanging up, so this must not buffer
		// a half-open connection or synthesise a clean close.
		downstream.on('error', destroyBoth);
		upstream.on('error', destroyBoth);
		downstream.on('close', destroyBoth);
		upstream.on('close', destroyBoth);
		downstream.pipe(upstream);
		upstream.pipe(downstream);
	});
	server.listen(listenPort, '0.0.0.0');
	return server;
});

const shutdown = () => {
	for (const server of servers) {
		server.close();
	}
	process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
