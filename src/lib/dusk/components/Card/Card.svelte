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

<div {...$$restProps} class={classes}>
	<div class="dusk-card__header">
		{#if iconPath}
			<div class="dusk-card__icon">
				<Icon path={iconPath} />
			</div>
		{/if}
		<p>{heading}</p>
	</div>
	<slot />
</div>
