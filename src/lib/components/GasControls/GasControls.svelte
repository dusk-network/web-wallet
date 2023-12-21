<svelte:options immutable={true}/>

<script>
	import { createEventDispatcher } from "svelte";
	import { Textbox } from "$lib/dusk/components";

	/** @type {Number} */
	export let limit;

	/** @type {Number} */
	export let limitLower;

	/** @type {Number} */
	export let limitUpper;

	/** @type {Number} */
	export let price;

	/** @type {Number} */
	export let priceLower;

	const dispatch = createEventDispatcher();

	const gas = {
		limit,
		price
	};

	function handleInput () {
		dispatch("setGasSettings", gas);
	}

</script>

<label for={undefined} class="gas-control">
	<span>Price</span>
	<Textbox
		bind:value={gas.price}
		placeholder="gas price"
		type="number"
		min={priceLower}
		required
		on:input={() => {
			handleInput();
		}}
	/>
</label>
<label for={undefined} class="gas-control">
	<span>Limit</span>
	<Textbox
		bind:value={gas.limit}
		placeholder="gas limit"
		type="number"
		max={limitUpper}
		min={limitLower}
		required
		on:input={() => {
			handleInput();
		}}
	/>
</label>

<style lang="postcss">
	.gas-control {
		display: flex;
		gap: .5em;
		width: 100%;
		flex-direction: column;
		justify-content: start;
		align-items: stretch;

		& > span {
			line-height: 140%;
		}
	}
</style>
