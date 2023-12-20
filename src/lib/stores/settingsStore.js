import { persisted } from "svelte-persisted-store";
import { browser } from "$app/environment";

const settingsStore = persisted(`${CONFIG.LOCAL_STORAGE_APP_KEY}-preferences`, {
	currency: "USD",
	darkMode: false,
	gasLimit: 1000000000,
	gasPrice: 10000000,
	language: browser ? navigator.language : "en",
	network: "testnet"
});

export default settingsStore;
