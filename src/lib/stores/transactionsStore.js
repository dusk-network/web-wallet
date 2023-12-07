import { readable } from "svelte/store";

import transactions from "./__tests__/mockData";

let timeoutID = 0;

/** @type {import("./stores").TransactionsStoreContent} */
const initialValue = { transactions: [] };

/** @type {import("./stores").TransactionsStore} */
const store = readable(initialValue, (set) => {
	clearTimeout(timeoutID);
	timeoutID = window.setTimeout(() => {
		set({ transactions });
	}, 500);
});

export default store;
