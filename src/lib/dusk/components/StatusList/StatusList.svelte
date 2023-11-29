<svelte:options immutable={true}/>

<script>
	import { makeClassName } from "$lib/dusk/string";
	import Statuses from "./Statuses.svelte";

	/** @type {String | Undefined} */
	export let className = undefined;

	/** @type {Status[]} */
	export let statuses;
</script>

<dl
	{...$$restProps}
	class={makeClassName(["dusk-status-list", className])}
>
	<Statuses {statuses}/>
</dl>
