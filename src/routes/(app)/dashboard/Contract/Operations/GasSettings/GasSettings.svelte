<script>
	import { slide } from "svelte/transition";
	import { mdiGasStationOutline } from "@mdi/js";
	import { Button, Icon } from "$lib/dusk/components";
	import { GasControls } from "$lib/components";
	import { createEventDispatcher } from "svelte";

	/** @type {number} */
	export let limit;

	/** @type {number} */
	export let limitLower;

	/** @type {number} */
	export let limitUpper;

	/** @type {string} A BCP 47 language tag */
	export let locale;

	/** @type {number} */
	export let price;

	/** @type {number} */
	export let priceLower;

	/** @type {boolean} */
	let gasSettings = false;

	const dispatch = createEventDispatcher();
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
				variant="tertiary"
				on:click={() => {
					gasSettings = !gasSettings;
				}}
				text={gasSettings ? "SAVE" : "EDIT"}
			/>
		</dd>
	</dl>
	{#if gasSettings}
		<div in:slide|global class="operation__gas-settings">
			<GasControls
				on:setGasSettings={(event) => { dispatch("setGasSettings", event.detail); }}
				{limit}
				{limitLower}
				{limitUpper}
				{locale}
				{price}
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
