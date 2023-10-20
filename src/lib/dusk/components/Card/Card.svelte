<script>
	import Icon from "../Icon/Icon.svelte";

	/** @type {string | Undefined} */
	export let iconPath = undefined;

	/** @type {string} */
	export let heading;
</script>

<div {...$$restProps} class="dusk-card">
	<div class="dusk-card__header">
		{#if iconPath}
			<div class="dusk-card__icon">
				<Icon path={iconPath}/>
			</div>
		{/if}
		<p>{heading}</p>
	</div>
	<slot/>
</div>
