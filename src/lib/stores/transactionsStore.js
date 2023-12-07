import { readable } from "svelte/store";

/** @type Transaction[] */
import transactions from "./__tests__/mockData";

let timeoutID = 0;

/** @type {import("svelte/store").Readable<{ transactions: Array<Transaction> | [] }>} */
const store = readable({ transactions: [] }, (set) => {
	clearTimeout(timeoutID);
	timeoutID = window.setTimeout(() => {
		set({ transactions });
	}, 500);
});

export default store;
