<svelte:options immutable={true}/>

<script>
	import { makeClassName } from "$lib/dusk/string";

	import Anchor from "../Anchor/Anchor.svelte";
	import Icon from "../Icon/Icon.svelte";

	import "./AnchorButton.css";

	/** @type {String | Undefined} */
	export let className = undefined;

	/** @type {Boolean} */
	export let disabled = false;

	/** @type {String} */
	export let href;

	/** @type {ButtonIconProp | Undefined} */
	export let icon = undefined;

	/** @type {ButtonVariant | Undefined } */
	export let variant = undefined;

	/** @type {String | Undefined} */
	export let text = undefined;

	$: classes = makeClassName([
		"dusk-anchor-button",
		disabled ? "dusk-anchor-button__disabled" : "",
		icon && text ? "dusk-icon-button-labeled" : icon ? "dusk-icon-button" : "",
		variant,
		className
	]);
</script>

<Anchor
	{...$$restProps}
	className={classes}
	{href}
	on:click
	tabindex={disabled ? "-1" : $$restProps.tabindex ?? undefined}
>
	{#if icon?.position === "after"}
		{#if text}
			<span>{text}</span>
		{/if}
		<Icon path={icon.path}/>
	{:else if icon}
		<Icon path={icon.path}/>
		{#if text}
			<span>{text}</span>
		{/if}
	{:else if text}
		<span>{text}</span>
	{/if}
</Anchor>
