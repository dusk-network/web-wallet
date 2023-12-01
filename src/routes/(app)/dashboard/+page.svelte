<svelte:options immutable={true}/>

<script>
	import {
		mdiArrowDownBoldBoxOutline,
		mdiArrowUpBoldBoxOutline,
		mdiCheckCircleOutline,
		mdiDatabaseArrowDownOutline,
		mdiDatabaseArrowUpOutline,
		mdiDatabaseOutline,
		mdiLockOpenVariantOutline,
		mdiLockOutline,
		mdiSwapVertical
	} from "@mdi/js";
	import { logo } from "$lib/dusk/icons";
	import { fade } from "svelte/transition";
	import { Tabs } from "$lib/dusk/components";
	import { Balance } from "$lib/components";
	import { createCurrencyFormatter } from "$lib/dusk/currency";
	import { balanceStore, settingsStore } from "$lib/stores";
	import { find, hasKeyValue } from "lamb";
	import Contract from "./Contract.svelte";

	/** @type {import('./$types').PageData} */
	export let data;

	const { currentPrice } = data;

	let selectedTab = "transfer";

	const { currency, language } = $settingsStore;
	const duskFormatter = createCurrencyFormatter(language, "DUSK");

	$: ({ dusk } = $balanceStore);
	$: CONTRACTS = [{
		icon: { path: mdiSwapVertical },
		id: "transfer",
		label: "Transact",
		operations: [{
			icon: { path: mdiArrowDownBoldBoxOutline, position: "before" },
			id: "receive",
			label: "receive"
		}, {
			icon: { path: mdiArrowUpBoldBoxOutline, position: "before" },
			id: "send",
			label: "send"
		}],
		statuses: [{
			key: {
				icon: {
					path: mdiCheckCircleOutline
				},
				label: "Spendable tokens"

			}, value: {
				icon: {
					label: "DUSK",
					path: logo
				},
				label: duskFormatter(dusk)
			}
		}]
	}, {
		icon: { path: mdiDatabaseOutline },
		id: "staking",
		label: "Stake",
		operations: [{
			icon: { path: mdiDatabaseArrowUpOutline, position: "before" },
			id: "stake",
			label: "stake"
		}, {
			icon: { path: mdiDatabaseArrowDownOutline, position: "before" },
			id: "withdraw",
			label: "withdraw"
		}, {
			icon: { path: mdiDatabaseArrowDownOutline, position: "before" },
			id: "withdraw-rewards",
			label: "withdraw rewards"
		}],
		statuses: [{
			key: {
				icon: {
					path: mdiLockOpenVariantOutline
				},
				label: "Unlocked tokens"

			}, value: {
				icon: {
					label: "DUSK",
					path: logo
				},
				label: duskFormatter(dusk)
			}
		}, {
			key: {
				icon: {
					path: mdiLockOutline
				},
				label: "Locked tokens"
			}, value: {
				icon: {
					label: "DUSK",
					path: logo
				},
				label: duskFormatter(dusk)
			}
		}, {
			key: {
				icon: {
					path: mdiDatabaseOutline
				},
				label: "Reward tokens"
			},
			value: {
				icon: {
					label: "DUSK",
					path: logo
				},
				label: duskFormatter(dusk)
			}
		}]
	}];

	$: selectedContract = find(CONTRACTS, hasKeyValue("id", selectedTab));
</script>

<div class="dashboard-content">
	<h2 class="visible-hidden">Dashboard</h2>

	<Balance
		tokens={dusk}
		tokenCurrency="DUSK"
		fiat={dusk * currentPrice[currency.toLowerCase()]}
		fiatCurrency={currency}
		locale={language}
	/>

	<div class="tabs">
		<Tabs bind:selectedTab={selectedTab} items={CONTRACTS}/>
		<div
			class="tabs__panel"
			class:tabs__panel--first={selectedTab === CONTRACTS[0].id}
			class:tabs__panel--last={selectedTab === CONTRACTS[CONTRACTS.length - 1].id}
		>
			{#key selectedTab}
				<div in:fade|global class="tabs__contract">
					<Contract contract={selectedContract}/>
				</div>
			{/key}
		</div>
	</div>
</div>

<style lang="postcss">
	.dashboard-content {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 1.375rem;
		overflow-y: auto;
		flex: 1;
	}

	.tabs {
		&__panel {
			border-radius: 1.25rem;
			background: var(--surface-color);
			transition: border-radius .4s ease-in-out;

			&--first {
				border-top-left-radius: 0;
			}

			&--last {
				border-top-right-radius: 0;
			}
		}

		&__contract {
			display: flex;
			padding: 1rem 1.375rem;
			flex-direction: column;
			justify-content: center;
			align-items: flex-start;
			gap: 1em;
			align-self: stretch;
			width: 100%;
		}
	}
</style>
