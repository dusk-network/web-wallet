<svelte:options immutable={true}/>

<script>
	import { makeClassName } from "$lib/dusk/string";

	import Icon from "../Icon/Icon.svelte";

	/** @type {Boolean} */
	export let active = false;

	/** @type {String | Undefined} */
	export let className = undefined;

	/** @type {ButtonIconProp | Undefined} */
	export let icon = undefined;

	/** @type {ButtonVariant | Undefined } */
	export let variant = undefined;

	/** @type {String | Undefined} */
	export let text = undefined;

	/** @type {"button" | "reset" | "submit" | "toggle"} */
	export let type = "button";

	$: classes = makeClassName([
		"duk-button",
		`duk-button-${type}`,
		icon && text ? "duk-icon-button-labeled" : icon ? "duk-icon-button" : "",
		type === "toggle" && active ? "duk-button-toggle__active" : "",
		variant,
		className
	]);
</script>

<button
	{...$$restProps}
	class={classes}
	on:click
	on:mousedown
	on:mouseup
	type={type === "toggle" ? "button" : type}
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
</button>
