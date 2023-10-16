<svelte:options immutable={true}/>

<script>
	import { makeClassName } from "$lib/dusk/string";

	/** @type {String | Undefined} */
	export let className = undefined;

	/** @type {TextboxTypes} */
	export let type = "text";

	/** @type {String} */
	export let value = "";

	const classes = makeClassName([
		"duk-textbox",
		`duk-textbox-${type}`,
		className
	]);
</script>

{#if type === "multiline"}
	<textarea {...$$restProps} class={classes} on:input>{value}</textarea>
{:else}
	<input
		{...$$restProps}
		class={classes}
		{type}
		on:input
		{value}
	/>
{/if}
