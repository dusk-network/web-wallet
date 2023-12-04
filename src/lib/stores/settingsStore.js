import { persisted } from "svelte-persisted-store";
import { browser } from "$app/environment";

const settingsStore = persisted("preferences", {
	currency: "USD",
	darkMode: false,
	language: browser ? navigator.language : "en",
	network: "testnet"
});

export default settingsStore;
