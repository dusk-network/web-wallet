<svelte:options immutable={true}/>

<script>
	import { makeClassName } from "$lib/dusk/string";

	import "./Icon.css";

	/** @type {String|Undefined} */
	export let className = undefined;

	/** @type {String|Undefined} */
	export let bgColor = undefined;

	$: commonAttributes = {
		...$$restProps,
		class: makeClassName(["dusk-icon--circular", className])
	};
</script>

<div style={`background-color: ${bgColor ? `#${ bgColor}` : "var(--secondary-color)"}`} {...commonAttributes}>
	<slot/>
</div>
