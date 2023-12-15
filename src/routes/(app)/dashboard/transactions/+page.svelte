<svelte:options immutable={true}/>

<script>
	import { mdiArrowLeft } from "@mdi/js";

	import { Balance } from "$lib/components";
	import { AnchorButton } from "$lib/dusk/components";
	import { settingsStore, transactionsStore, walletStore } from "$lib/stores";

	import Transactions from "../Transactions.svelte";

	/** @type {import('./$types').PageData} */
	export let data;

	const { currentPrice } = data;
	const { currency, language } = $settingsStore;

	$: ({ balance } = $walletStore);
	$: ({ transactions } = $transactionsStore);
</script>

<div class="dashboard-content">
	<h2 class="visible-hidden">Transactions</h2>

	<Balance
		tokens={balance.value}
		tokenCurrency="DUSK"
		fiat={balance.value * currentPrice[currency.toLowerCase()]}
		fiatCurrency={currency}
		locale={language}
	/>

	<Transactions {transactions}>
		<h3 class="h4" slot="heading">Transactions</h3>
		<AnchorButton
			slot="controls"
			href="/dashboard"
			text="Back"
			icon={{
				path: mdiArrowLeft
			}}
			variant="tertiary"
		/>
	</Transactions>

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
</style>
