import { readable } from "svelte/store";

let timeoutID = 0;

const balance = readable({ dusk: 0 }, (set) => {
	clearTimeout(timeoutID);
	timeoutID = window.setTimeout(() => {
		set({ dusk: 50000 });
	}, 500);
});

export default balance;
