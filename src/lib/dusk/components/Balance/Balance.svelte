<svelte:options immutable={true}/>

<script>
	import { Icon, Tooltip } from "$lib/dusk/components";
	import { logo } from "$lib/dusk/icons";
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

	/** @type {String} */
	export let locale = "en";

	$: classes = makeClassName([
		"dusk-balance",
		className
	]);

	const TOKEN_CURRENCY = "DUSK";

	const duskFormatter = createCurrencyFormatter(locale, TOKEN_CURRENCY);
	const fiatFormatter = createCurrencyFormatter(locale, currency);
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
			path={logo}
			data-tooltip-id="balance-tooltip"
			data-tooltip-text={TOKEN_CURRENCY}
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
