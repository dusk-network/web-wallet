import { persisted } from "svelte-persisted-store";

const settingsStore = persisted("preferences", {
	currency: "usd",
	language: navigator.language
});

export default settingsStore;
