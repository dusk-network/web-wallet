<script>
	import Icon from "../Icon/Icon.svelte";
	import { makeClassName } from "$lib/dusk/string";

	/** @type {String | Undefined} */
	export let className = undefined;

	/** @type {string | Undefined} */
	export let iconPath = undefined;

	/** @type {string} */
	export let heading;

	$: classes = makeClassName(["duk-card", className]);
</script>

<section {...$$restProps} class={classes}>
	<header class="duk-card__header">
		{#if iconPath}
			<Icon className="duk-card__icon" path={iconPath} />
		{/if}
		<h2>{heading}</h2>
	</header>
	<slot />
</section>
