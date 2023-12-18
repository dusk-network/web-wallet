<svelte:options immutable={true}/>

<script>
	import {
		mdiArrowDownBoldBoxOutline,
		mdiArrowUpBoldBoxOutline,
		mdiDatabaseArrowDownOutline,
		mdiDatabaseOutline,
		mdiEyeOffOutline,
		mdiSwapVertical
	} from "@mdi/js";
	import { fade } from "svelte/transition";
	import { find, hasKeyValue } from "lamb";

	import { logo } from "$lib/dusk/icons";
	import { AnchorButton, Button, Tabs } from "$lib/dusk/components";
	import { Balance } from "$lib/components";
	import {
		operationsStore,
		settingsStore,
		transactionsStore,
		walletStore
	} from "$lib/stores";

	import Contract from "./Contract.svelte";
	import { Receive } from "./Contract/Operations";
	import Transactions from "./Transactions.svelte";
	import KeyPicker from "./KeyPicker.svelte";

	/** @type {import('./$types').PageData} */
	export let data;

	let selectedTab = "transfer";
	let show = false;

	const { currentPrice } = data;
	const { currency, language } = $settingsStore;
	const TRANSACTION_LIMIT = 5;
	const { isSyncing, error } = $walletStore;
	const { reset } = operationsStore;

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
				label: "Spendable"
			}, value: {
				icon: {
					label: "DUSK",
					path: logo
				},
				value: 0
			}
		}, {
			key: {
				label: "Total Locked"
			}, value: {
				icon: {
					label: "DUSK",
					path: logo
				},
				value: 0
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
				value: 0
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

	<div class="attention" class:attention--focus={currentOperation !== undefined}>
		<Balance
			className="attention__balance"
			tokens={balance.value}
			tokenCurrency="DUSK"
			fiat={balance.value * currentPrice[currency.toLowerCase()]}
			fiatCurrency={currency}
			locale={language}
		/>

		{#if isSyncing || error}
			<Button
				className="dashboard-content__receive"
				variant="secondary"
				on:click={() => {
					show = !show;
				}}
				icon={!show
					? { path: mdiArrowDownBoldBoxOutline }
					: { path: mdiEyeOffOutline }}
				text={!show ? "receive" : "hide"}
			/>
			{#if show}
				<Receive publicSpendKey={currentKey} hideBackButton={true}/>
			{/if}
		{:else}
			<article class="tabs">
				<Tabs bind:selectedTab items={CONTRACTS} on:change={() => { reset(); }}/>
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
		{/if}

		<Transactions
			className="attention__transactions"
			transactions={transactions.slice(-Math.abs(TRANSACTION_LIMIT))}
		>
			<h3 class="h4" slot="heading">Transactions</h3>
			<AnchorButton
				className="view-transactions"
				slot="controls"
				href="/dashboard/transactions"
				text="View all transactions"
				variant="tertiary"
			/>
		</Transactions>
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
		position: relative;

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

	.attention {
		display: flex;
		flex-direction: column;
		position: relative;
		gap: 1.375rem;
		height: 100%;

		&--focus {
			:global(& .attention__balance) {
				opacity: 0;
				max-height: 0;
				transition: all 1s ease-out;
			}

			:global(& .attention__transactions) {
				display: none;
				max-height: 0;
			}
		}

		:global(&__balance) {
			opacity: 1;
			max-height: 100%;
			transition: all 1s ease-in;
		}

		:global(&__transactions) {
			max-height: 100%;
			transition: max-height 1s ease-in;
			display: block;
		}
	}

	.tabs {
		width: 100%;
		display: flex;
		flex-direction: column;
		flex-grow: 1;

		&__panel {
			border-radius: 1.25rem;
			background: var(--surface-color);
			transition: border-radius 0.4s ease-in-out;
			height: 100%;
			display: flex;
			flex-direction: column;
			flex-grow: 1;

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
			flex-grow: 1;
		}
	}

	:global(.view-transactions) {
		width: 100%;
	}
</style>
