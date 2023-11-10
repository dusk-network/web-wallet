<svelte:options immutable={true}/>

<script>
	import { fade } from "svelte/transition";
	import {
		Tabs
	} from "$lib/dusk/components";
	import { mdiDatabaseOutline, mdiSwapVertical } from "@mdi/js";

	const items = [
		{ icon: { path: mdiSwapVertical }, id: "tab-transfer" },
		{ icon: { path: mdiDatabaseOutline }, id: "tab-staking" }
	];

	let selectedTab = "tab-transfer";
</script>

<section class="content">
	<h2 class="visible-hidden">Dashboard</h2>
	<Tabs bind:selectedTab={selectedTab} items={items}/>
	<div class="tab-panel">
		{#key selectedTab}
			<div in:fade class="contract">
				{selectedTab}
			</div>
		{/key}
	</div>
</section>

<style>
	.content {
		width: 100%;
	}
	.contract {
		display: flex;
		padding: 1rem 1.375rem;
		flex-direction: column;
		justify-content: center;
		align-items: flex-start;
		gap: 1rem;
		align-self: stretch;

		&__heading {
			color: var(--primary-color);
			font-size: 1.125rem;
			line-height: 150%;
			letter-spacing: -0.01125rem;
		}
	}

	.tab-panel {
		border-radius: 0rem 1.25rem 1.25rem 1.25rem;
		background: var(--surface-color);
	}
</style>
