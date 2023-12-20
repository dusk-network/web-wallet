<script>
	import { slide } from "svelte/transition";
	import { mdiGasStationOutline } from "@mdi/js";
	import { Button, Icon } from "$lib/dusk/components";
	import { GasControls } from "$lib/components";
	import { createEventDispatcher } from "svelte";

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

	let gas = {
		limit,
		price
	};
	let gasSettings = false;
</script>

<div class="operation__gas-settings">
	<dl class="operation__gas-settings-edit">
		<dt class="dusk-status-list__key">
			<Icon path={mdiGasStationOutline}/>
			<span>Default Gas Settings</span>
		</dt>
		<dd>
			<Button
				size="small"
				variant={gasSettings ? "secondary" : "tertiary"}
				on:click={() => {
					gasSettings = !gasSettings;

					if (!gasSettings) {
						dispatch("setGasSettings", gas);
					}
				}}
				text={gasSettings ? "SAVE" : "EDIT"}
			/>
		</dd>
	</dl>
	{#if gasSettings}
		<div in:slide|global class="operation__gas-settings">
			<GasControls
				on:setGasSettings={(event) => { gas = event.detail; }}
				limit={gas.limit}
				{limitLower}
				{limitUpper}
				price={gas.price}
				{priceLower}
			/>
		</div>
	{/if}
</div>

<style lang="postcss">
	.operation__gas-settings {
		display: flex;
		flex-direction: column;
		gap: 0.625em;
	}

	.operation__gas-settings-edit {
		display: flex;
		flex-direction: row;
		justify-content: space-between;
	}

	:global(.operation__gas-settings .operation__input-field) {
		width: 100%;
		padding: 0.5em 1em;
	}
</style>
