<svelte:options immutable={true}/>

<script>
	import { makeClassName } from "$lib/dusk/string";

	import "./Icon.css";

	/** @type {String|Undefined} */
	export let className = undefined;

	/** @type {Boolean} */
	export let isInStack = false;

	/** @type {String} */
	export let path;

	/** @type {String} */
	export let role = "graphics-symbol";

	/** @type {String} */
	let classes;

	$: classes = makeClassName(["dusk-icon", className]);
</script>

{#if isInStack}
	<g class={classes}>
		<rect/>
		<path d={path}/>
	</g>
{:else}
	<svg
		class={classes}
		role={role}
		viewBox="0 0 24 24"
	>
		<path d={path}/>
	</svg>
{/if}
