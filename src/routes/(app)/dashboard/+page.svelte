<svelte:options immutable={true}/>

<script>
	import { fade } from "svelte/transition";
	import {
		Balance,
		Tabs
	} from "$lib/dusk/components";
	import { settingsStore } from "$lib/settings";
	import { mdiDatabaseOutline, mdiSwapVertical } from "@mdi/js";

	/** @type {import('./$types').PageData} */
	export let data;

	const items = [
		{ icon: { path: mdiSwapVertical }, id: "tab-transfer" },
		{ icon: { path: mdiDatabaseOutline }, id: "tab-staking" }
	];
	const { currency, language } = $settingsStore;

	let selectedTab = "tab-transfer";

</script>

<div class="content">
	<h2 class="visible-hidden">Dashboard</h2>

	<Balance
		dusk={data.dusk}
		fiat={data.fiat}
		currency={currency}
		locale={language}/>

	<div class="tabs">
		<Tabs bind:selectedTab={selectedTab} items={items}/>
		<div class="tabs__panel">
			{#key selectedTab}
				<div in:fade class="contract">
					{selectedTab}
				</div>
			{/key}
		</div>
	</div>
</div>

<style>
	.content {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 1.375rem;
	}

	.contract {
		display: flex;
		padding: 1rem 1.375rem;
		flex-direction: column;
		justify-content: center;
		align-items: flex-start;
		gap: 1rem;
		align-self: stretch;
	}

	.tabs .tabs__panel {
		border-radius: 0rem 1.25rem 1.25rem 1.25rem;
		background: var(--surface-color);
	}
</style>
