<svelte:options immutable={true}/>

<script>
	import { Icon, Tooltip } from "$lib/dusk/components";
	import { DUSK_LOGO_PATH } from "$lib/dusk/icons/logo";
	import { makeClassName } from "$lib/dusk/string";
	import { createCurrencyFormatter } from "$lib/dusk/currency";

	/** @type {String | Undefined} */
	export let className = undefined;

	/** @type {Number} */
	export let dusk = 0;

	/** @type {Number} */
	export let fiat = 0;

	/** @type {String} */
	export let currency = "USD";

	$: classes = makeClassName([
		"dusk-balance",
		className
	]);

	const duskFormatter = createCurrencyFormatter("en-US", "DUSK");
	const fiatFormatter = createCurrencyFormatter("en-US", currency);
</script>

<article
	{...$$restProps}
	class={classes}
>
	<header class="dusk-balance__header">
		<h2>Your Balance:</h2>
	</header>
	<p class="dusk-balance__dusk">
		<strong>{duskFormatter(dusk)}</strong>
		<Icon
			className="dusk-balance__icon"
			path={DUSK_LOGO_PATH}
			data-tooltip-id="balance-tooltip"
			data-tooltip-text="DUSK"
			data-tooltip-place="right"
		/>
	</p>
	<p class="dusk-balance__fiat">
		<strong>
			({fiatFormatter(fiat)})
		</strong>
	</p>
	<Tooltip id="balance-tooltip"/>
</article>
