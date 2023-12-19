<svelte:options immutable={true}/>

<script>

	/**
	 * When a target attribute is used the component automatically
	 * adds the "noopener" and "noreferrer" strings to the `rel` attribute.
	 * @see https://mathiasbynens.github.io/rel-noopener/
	 */

	import { makeClassName } from "$lib/dusk/string";

	import "./Anchor.css";

	/** @type {String | Undefined} */
	export let className = undefined;

	/** @type {String} */
	export let href;

	/** @type {String | Undefined} */
	export let rel = undefined;

	/** @type {String | Undefined} */
	export let target = undefined;
</script>

<a
	{...$$restProps}
	class={makeClassName(["dusk-anchor", className])}
	{href}
	on:click
	rel={target ? makeClassName([rel, "noopener", "noreferrer"]) : rel}
	{target}
>
	<slot/>
</a>
