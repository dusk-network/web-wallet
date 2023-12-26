<svelte:options immutable={true}/>

<script>
	import {
		AnchorButton,
		ErrorDetails,
		Icon,
		Throbber
	} from "$lib/dusk/components";
	import { mdiCheckDecagramOutline, mdiCloseThick } from "@mdi/js";

	import { makeClassName } from "$lib/dusk/string";

	/** @type {String | Undefined} */
	export let className = undefined;

	/** @type {Promise<any>} */
	export let operation;

	/** @type {String} */
	export let errorMessage = "Operation failed";

	/** @type {Function | Undefined} */
	export let onBeforeLeave = undefined;

	/** @type {String} */
	export let pendingMessage = "";

	/** @type {String} */
	export let successMessage = "Operation completed";

	$: classes = makeClassName(["operation-result", className]);

	/** @param {Event} event */
	function handleGoHomeClick (event) {
		event.preventDefault();

		onBeforeLeave && onBeforeLeave();
	}
</script>

<div class={classes}>
	{#await operation}
		<Throbber/>
		<span>{pendingMessage}</span>
	{:then}
		<Icon
			path={mdiCheckDecagramOutline}
			size="large"
		/>
		<span>{successMessage}</span>
		<slot name="success-content"/>
		<AnchorButton
			href="/dashboard"
			on:click={handleGoHomeClick}
			variant="tertiary"
			text="HOME"
		/>
	{:catch error}
		<Icon
			path={mdiCloseThick}
			size="large"
		/>
		<ErrorDetails
			{error}
			summary={errorMessage}
		/>
		<slot name="error-content"/>
		<AnchorButton
			href="/dashboard"
			on:click={handleGoHomeClick}
			variant="tertiary"
			text="HOME"
		/>
	{/await}
</div>

<style lang="postcss">
	.operation-result {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--large-gap);
		padding: 1.5em 0;

		:global(.dusk-anchor-button) {
			width: 100%;
		}
	}
</style>
