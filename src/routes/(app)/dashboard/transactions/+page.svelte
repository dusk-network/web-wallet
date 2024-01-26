<svelte:options immutable={true}/>

<script>
	import { Balance, Transactions } from "$lib/components";
	import { settingsStore, walletStore } from "$lib/stores";

	/** @type {import('./$types').PageData} */
	export let data;

	const { currentPrice } = data;
	const { currency, language } = $settingsStore;

	$: ({ balance } = $walletStore);
</script>

<div class="transactions">
	<h2 class="visible-hidden">Transactions</h2>

	<Balance
		tokens={balance.value}
		tokenCurrency="DUSK"
		fiat={balance.value * currentPrice[currency.toLowerCase()]}
		fiatCurrency={currency}
		locale={language}
	/>

	<Transactions/>
</div>

<style lang="postcss">
	.transactions {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 1.375rem;
		overflow-y: auto;
		flex: 1;
	}
</style>
