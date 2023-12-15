<script>
	import { logo } from "$lib/dusk/icons";
	import { Icon } from "$lib/dusk/components";
	import { mdiArrowDownBoldBoxOutline } from "@mdi/js";

	/** @type {Status[]} */
	export let statuses = [];

	$: rewards = statuses.filter((status) => {
		return status.key.label === "Reward tokens";
	});
</script>

<dl class="operation__stake-rewards">
	<dt class="dusk-status-list__key">
		<Icon path={mdiArrowDownBoldBoxOutline}/>
		<span>Staking Rewards:</span>
	</dt>
	<dd class="dusk-status-list__value operation__stake-rewards-value">
		<span>
			{rewards.length !== 0 ? rewards[0].value.label : 0}
		</span>
		<Icon
			className="dusk-rewards__icon"
			path={logo}
			data-tooltip-id="status-tooltip"
			data-tooltip-text="DUSK"
			data-tooltip-place="top"
		/>
	</dd>
</dl>

<style lang="postcss">
	.operation__stake-rewards {
		display: flex;
		flex-direction: column;
		gap: 0.625em;
	}

	.operation__stake-rewards-value {
		justify-content: flex-start;
	}
</style>
