import { persisted } from "svelte-persisted-store";
import { browser } from "$app/environment";

const settingsStore = persisted("preferences", {
	currency: "USD",
	language: browser ? navigator.language : "en"
});

export default settingsStore;
