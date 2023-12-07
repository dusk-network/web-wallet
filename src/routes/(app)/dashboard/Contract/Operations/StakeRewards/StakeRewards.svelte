<script>
	import { logo, sendWallet } from "$lib/dusk/icons";
	import { Icon } from "$lib/dusk/components";

	/** @type {Status[]} */
	export let statuses = [];

	$: rewards = statuses.filter((status) => {
		return status.key.label === "Reward tokens";
	});
</script>

<dl class="operation__rewards__review">
	<dt class="dusk-status-list__key">
		<Icon className="dusk-rewards__icon" path={sendWallet}/>
		<span>Staking Rewards:</span>
	</dt>
	<dd class="dusk-status-list__value operation__rewards__value">
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
	.operation__rewards__review {
		display: flex;
		flex-direction: column;
		gap: 0.625em;
	}

	.operation__rewards__value {
		justify-content: flex-start;
	}
</style>
