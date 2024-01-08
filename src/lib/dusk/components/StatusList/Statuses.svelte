<svelte:options immutable={true}/>

<script>
	import { Icon, Tooltip } from "$lib/dusk/components";
	import { createCurrencyFormatter } from "$lib/dusk/currency";
	import { settingsStore } from "$lib/stores";
	const { language } = $settingsStore;
	const duskFormatter = createCurrencyFormatter(language, "DUSK", 2);

	/** @type Status[] */
	export let statuses;
</script>

{#each statuses as status (status.key)}
	<dt class="dusk-status-list__key dusk-status">
		{#if status.key.icon}
			<Icon
				className="dusk-status__icon"
				path={status.key.icon.path ?? ""}
				data-tooltip-id={status.key.icon.label && "status-tooltip"}
				data-tooltip-text={status.key.icon.label ?? ""}
				data-tooltip-place="top"
			/>
		{/if}
		<span>{status.key.label}</span>
	</dt>
	<dd class="dusk-status-list__value dusk-status">
		<span>{duskFormatter(status.value.value)}</span>
		{#if status.value.icon}
			<Icon
				className="dusk-status__icon"
				path={status.value.icon.path ?? ""}
				data-tooltip-id={status.value.icon.label && "status-tooltip"}
				data-tooltip-text={status.value.icon.label ?? ""}
				data-tooltip-place="top"
			/>
		{/if}
	</dd>
{/each}

<Tooltip id="status-tooltip"/>
