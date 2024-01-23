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
	let isExpanded = false;

	const dispatch = createEventDispatcher();
</script>

<div class="gas-settings">
	<dl class="gas-settings__edit">
		<dt class="gas-settings__edit-label">
			<Icon path={mdiGasStationOutline}/>
			<span>Default Gas Settings</span>
		</dt>
		<dd>
			<Button
				size="small"
				variant="tertiary"
				on:click={() => {
					isExpanded = !isExpanded;
				}}
				text={isExpanded ? "SAVE" : "EDIT"}
			/>
		</dd>
	</dl>
	{#if isExpanded}
		<div in:slide|global class="gas-settings">
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
	.gas-settings {
		display: flex;
		flex-direction: column;
		gap: 0.625em;
	}

	.gas-settings__edit {
		display: flex;
		flex-direction: row;
		justify-content: space-between;
	}

	.gas-settings__edit-label {
		display: inline-flex;
		align-items: center;
		gap: var(--small-gap);
	}
</style>
