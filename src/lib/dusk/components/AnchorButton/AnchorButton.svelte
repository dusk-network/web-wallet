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

	/** @type {String | Undefined} */
	export let text = undefined;

	$: classes = makeClassName([
		"duk-anchor-button",
		disabled ? "duk-anchor-button__disabled" : "",
		icon && text ? "duk-icon-button-labeled" : icon ? "duk-icon-button" : "",
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
