<script>
	import Icon from "../Icon/Icon.svelte";
	import { makeClassName } from "$lib/dusk/string";

	/** @type {String | Undefined} */
	export let className = undefined;

	/** @type {string | Undefined} */
	export let iconPath = undefined;

	/** @type {string} */
	export let heading;

	$: classes = makeClassName(["dusk-card", className]);
</script>

<section {...$$restProps} class={classes}>
	<header class="dusk-card__header">
		{#if iconPath}
			<Icon className="dusk-card__icon" path={iconPath} size="large"/>
		{/if}
		<h2>{heading}</h2>
	</header>
	<slot/>
</section>
