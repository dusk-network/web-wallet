import { writable } from "svelte/store";

/** @type {import("svelte/store").Writable<{ currentOperation: number | undefined }>} */
const count = writable({ currentOperation: undefined });

export default count;
