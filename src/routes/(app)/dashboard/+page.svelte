<svelte:options immutable={true}/>

<script>
	import {
		mdiArrowDownBoldBoxOutline,
		mdiArrowUpBoldBoxOutline,
		mdiCheckCircleOutline,
		mdiDatabaseArrowDownOutline,
		mdiDatabaseOutline,
		mdiLockOutline,
		mdiSwapVertical
	} from "@mdi/js";
	import { fade } from "svelte/transition";
	import { find, hasKeyValue } from "lamb";

	import { logo } from "$lib/dusk/icons";
	import { AnchorButton, Tabs } from "$lib/dusk/components";
	import { Balance } from "$lib/components";
	import { createCurrencyFormatter } from "$lib/dusk/currency";
	import {
		operationsStore,
		settingsStore,
		transactionsStore,
		walletStore
	} from "$lib/stores";

	import Contract from "./Contract.svelte";
	import Transactions from "./Transactions.svelte";
	import KeyPicker from "./KeyPicker.svelte";

	/** @type {import('./$types').PageData} */
	export let data;

	let selectedTab = "transfer";

	const { currentPrice } = data;
	const { currency, language } = $settingsStore;
	const duskFormatter = createCurrencyFormatter(language, "DUSK");
	const TRANSACTION_LIMIT = 5;

	$: ({ balance, currentKey, keys } = $walletStore);
	$: ({ currentOperation } = $operationsStore);
	$: ({ transactions } = $transactionsStore);
	$: CONTRACTS = [{
		icon: { path: mdiSwapVertical },
		id: "transfer",
		label: "Transact",
		operations: [{
			icon: { path: mdiArrowUpBoldBoxOutline, position: "before" },
			id: "send",
			label: "send"
		}, {
			icon: { path: mdiArrowDownBoldBoxOutline, position: "before" },
			id: "receive",
			label: "receive",
			variant: "tertiary"
		}],
		statuses: [{
			key: {
				icon: {
					path: mdiCheckCircleOutline
				},
				label: "Spendable"

			}, value: {
				icon: {
					label: "DUSK",
					path: logo
				},
				label: duskFormatter(balance.maximum)
			}
		}]
	}, {
		icon: { path: mdiDatabaseOutline },
		id: "staking",
		label: "Stake",
		operations: [{
			icon: { path: mdiDatabaseOutline, position: "before" },
			id: "stake",
			label: "stake"
		}, {
			icon: { path: mdiDatabaseArrowDownOutline, position: "before" },
			id: "withdraw-stake",
			label: "withdraw stake",
			variant: "tertiary"
		}, {
			icon: { path: mdiDatabaseArrowDownOutline, position: "before" },
			id: "withdraw-rewards",
			label: "withdraw rewards",
			variant: "tertiary"
		}],
		statuses: [{
			key: {
				icon: {
					path: mdiCheckCircleOutline
				},
				label: "Spendable"

			}, value: {
				icon: {
					label: "DUSK",
					path: logo
				},
				label: duskFormatter(0)
			}
		}, {
			key: {
				icon: {
					path: mdiLockOutline
				},
				label: "Total Locked"
			}, value: {
				icon: {
					label: "DUSK",
					path: logo
				},
				label: duskFormatter(0)
			}
		}, {
			key: {
				icon: {
					path: mdiDatabaseOutline
				},
				label: "Rewards"
			},
			value: {
				icon: {
					label: "DUSK",
					path: logo
				},
				label: duskFormatter(0)
			}
		}]
	}];
	$: selectedContract = find(CONTRACTS, hasKeyValue("id", selectedTab));
</script>

<div class="dashboard-content">
	<h2 class="visible-hidden">Dashboard</h2>

	<KeyPicker
		{keys}
		{currentKey}
	/>

	<Balance
		tokens={balance.value}
		tokenCurrency="DUSK"
		fiat={balance.value * currentPrice[currency.toLowerCase()]}
		fiatCurrency={currency}
		locale={language}
	/>

	<article class="tabs">
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
	</article>

	{#if currentOperation === undefined && selectedTab === "transfer" }
		<Transactions transactions={transactions.slice(-Math.abs(TRANSACTION_LIMIT))}>
			<h3 class="h4" slot="heading">Transactions</h3>
			<AnchorButton
				className="view-transactions"
				slot="controls"
				href="/dashboard/transactions"
				text="View all transactions"
				variant="tertiary"
			/>
		</Transactions>
	{/if}
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

	:global(.view-transactions) {
		width: 100%;
	}
</style>
