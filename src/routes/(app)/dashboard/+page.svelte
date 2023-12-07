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
	import { AnchorButton, Tabs } from "$lib/dusk/components";
	import { Balance } from "$lib/components";
	import { createCurrencyFormatter } from "$lib/dusk/currency";
	import { balanceStore, operationsStore, settingsStore } from "$lib/stores";
	import { find, hasKeyValue } from "lamb";
	import Contract from "./Contract.svelte";
	import KeyPicker from "./KeyPicker.svelte";
	import Transactions from "./Transactions.svelte";

	/** @type Transaction[] */
	import transactions from "./__tests__/mockData";

	/** @type {import('./$types').PageData} */
	export let data;

	const { currentPrice } = data;
	let { currentKey, keys } = data;

	let selectedTab = "transfer";

	const { currency, language } = $settingsStore;
	const duskFormatter = createCurrencyFormatter(language, "DUSK");

	$: ({ dusk } = $balanceStore);
	$: ({ currentOperation } = $operationsStore);
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

	// ================================
	// SECTION: Change Key functionality
	// ================================
	// Description: This section contains the logic for the change key functionality

	let generatingKey = false;

	/**
	 * @param {Number} length
	 * @note Helper function to generate a random key – used for testing purposes
	 */
	function generateRandomKey (length) {
		let result = "";
		const characters = "abcdefghijklmnopqrstuvwxyz0123456789";
		const charactersLength = characters.length;

		for (let i = 0; i < length; i++) {
			result += characters.charAt(Math.floor(Math.random() * charactersLength));
		}

		return result;
	}

	async function generateKey () {
		generatingKey = true;

		try {
			await new Promise(resolve => setTimeout(resolve, 5000));

			const randomKey = generateRandomKey(32);

			keys = [randomKey, ...keys];
		} finally {
			generatingKey = false;
		}
	}
</script>

<div class="dashboard-content">
	<h2 class="visible-hidden">Dashboard</h2>

	<KeyPicker
		{generatingKey}
		bind:keys
		bind:currentKey
		on:generateKey={generateKey}/>

	<Balance
		tokens={dusk}
		tokenCurrency="DUSK"
		fiat={dusk * currentPrice[currency.toLowerCase()]}
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

	{#if currentOperation === undefined }
		<Transactions transactions={transactions.splice(0)}>
			<h3 class="h4" slot="heading">Transactions</h3>
			<AnchorButton
				slot="controls"
				href="/dashboard/transactions"
				text="View all transactions"
				variant="secondary"
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
</style>
