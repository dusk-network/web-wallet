// Runs before the app's test setup, which replaces `fetch`: the capture
// reads testnet with Node's own.
globalThis.nodeFetch = globalThis.fetch;
