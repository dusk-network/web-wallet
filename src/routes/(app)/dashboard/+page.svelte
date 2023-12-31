<svelte:options immutable={true}/>

<script>
	import {
		mdiArrowDownBoldBoxOutline,
		mdiArrowUpBoldBoxOutline,
		mdiDatabaseArrowDownOutline,
		mdiDatabaseOutline,
		mdiSwapVertical
	} from "@mdi/js";
	import { fade } from "svelte/transition";
	import {
		compose,
		find,
		hasKeyValue,
		take
	} from "lamb";

	import { logo } from "$lib/dusk/icons";
	import {
		AnchorButton, Card, Tabs, Throbber
	} from "$lib/dusk/components";
	import { Balance } from "$lib/components";
	import {
		operationsStore,
		settingsStore,
		walletStore
	} from "$lib/stores";
	import { sortByHeightDesc } from "$lib/transactions";

	import Contract from "./Contract.svelte";
	import Transactions from "./Transactions.svelte";
	import KeyPicker from "./KeyPicker.svelte";

	/** @type {import('./$types').PageData} */
	export let data;

	let selectedTab = "transfer";

	const { currentPrice } = data;
	const {
		currency,
		dashboardTransactionLimit,
		language
	} = $settingsStore;

	$: ({
		balance, currentKey, keys
	} = $walletStore);
	$: ({ currentOperation } = $operationsStore);

	/** @type {WalletStakeInfo} */
	let stakeInfo;

	$: if (selectedTab || currentOperation) {
		fetchStakeInfo();
	}

	async function fetchStakeInfo () {
		walletStore.getStakeInfo().then((info) => {
			stakeInfo = info;
		});
	}

	const getTransactionsShortlist = compose(
		take(dashboardTransactionLimit),
		sortByHeightDesc
	);

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
				label: "Spendable"

			}, value: {
				icon: {
					label: "DUSK",
					path: logo
				},
				value: balance.maximum
			}
		}]
	}, {
		icon: { path: mdiDatabaseOutline },
		id: "staking",
		label: "Stake",
		operations: [{
			// Disabled if user has staked already or
			// if the key is not allowed to stake
			disabled: !stakeInfo?.has_key || stakeInfo?.has_staked,
			icon: { path: mdiDatabaseOutline, position: "before" },
			id: "stake",
			label: "stake"
		}, {
			disabled: !stakeInfo?.has_staked,
			icon: { path: mdiDatabaseArrowDownOutline, position: "before" },
			id: "withdraw-stake",
			label: "withdraw stake",
			variant: "tertiary"
		}, {
			disabled: !(stakeInfo?.reward > 0),
			icon: { path: mdiDatabaseArrowDownOutline, position: "before" },
			id: "withdraw-rewards",
			label: "withdraw rewards",
			variant: "tertiary"
		}],
		statuses: [{
			key: {
				label: "Spendable"
			}, value: {
				icon: {
					label: "DUSK",
					path: logo
				},
				value: balance.maximum
			}
		}, {
			key: {
				label: "Total Locked"
			}, value: {
				icon: {
					label: "DUSK",
					path: logo
				},
				value: stakeInfo?.amount ?? 0
			}
		}, {
			key: {
				label: "Rewards"
			},
			value: {
				icon: {
					label: "DUSK",
					path: logo
				},
				value: stakeInfo?.reward ?? 0
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
		<Tabs
			bind:selectedTab
			items={CONTRACTS}
			on:change={() =>
				operationsStore.update((store) => ({
					...store,
					currentOperation: undefined
				}))
			}
		/>
		<div
			class="tabs__panel"
			class:tabs__panel--first={selectedTab === CONTRACTS[0].id}
			class:tabs__panel--last={selectedTab
				=== CONTRACTS[CONTRACTS.length - 1].id}
		>
			{#key selectedTab}
				<div in:fade|global class="tabs__contract">
					<Contract contract={selectedContract}/>
				</div>
			{/key}
		</div>
	</article>

	{#if currentOperation === undefined && selectedTab === "transfer" }
		{#await walletStore.getTransactionsHistory()}
			<Throbber className="loading"/>
		{:then transactions}
			<Transactions transactions={getTransactionsShortlist(transactions)}>
				<h3 class="h4" slot="heading">Transactions</h3>
				<AnchorButton
					className="view-transactions"
					slot="controls"
					href="/dashboard/transactions"
					text="View all transactions"
					variant="tertiary"
				/>
			</Transactions>
		{:catch e}
			<Card heading="Error getting transactions">
				<pre>{e}</pre>
			</Card>
		{/await}
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

		:global(&__receive) {
			text-align: left;

			:global(svg) {
				height: var(--icon-size);
				width: var(--icon-size);
			}
		}

		:global(&__receive + .receive) {
			:global(.receive__qr) {
				padding: 2em;
			}
		}
	}

	.tabs {
		&__panel {
			border-radius: 1.25rem;
			background: var(--surface-color);
			transition: border-radius 0.4s ease-in-out;

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

	:global(.loading) {
		align-self: center;
	}
</style>
