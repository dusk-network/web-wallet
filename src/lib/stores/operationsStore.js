import { writable } from "svelte/store";

const initialState = {
	currentOperation: undefined
};

/** @type {import("svelte/store").Writable<{ currentOperation: number | undefined }>} */
const operationsStore = writable(initialState);
const { set, subscribe, update } = operationsStore;

function reset () {
	set(initialState);
}

export default { reset, subscribe, update };
