import { persisted } from "svelte-persisted-store";

const settingsStore = persisted("preferences", {
	currency: "USD",
	language: navigator.language
});

export default settingsStore;
