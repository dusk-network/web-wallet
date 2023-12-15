<script>
	import { logo } from "$lib/dusk/icons";
	import { Icon } from "$lib/dusk/components";
	import { createCurrencyFormatter } from "$lib/dusk/currency";
	import { settingsStore } from "$lib/stores";
	import { mdiArrowDownBoldBoxOutline } from "@mdi/js";

	/** @type {StakeType} */
	export let flow;

	function getLabel () {
		switch (flow) {
			case "withdraw-stake":
				return "Withdraw Amount:";
			case "withdraw-rewards":
				return "Withdraw Rewards:";
			default:
				return "Amount:";
		}
	}

	/** @type { Number } */
	export let amount;

	const { language } = $settingsStore;
	const duskFormatter = createCurrencyFormatter(language, "DUSK");
</script>

<dl class="stake-overview">
	<dt class="dusk-status-list__key">
		<Icon path={mdiArrowDownBoldBoxOutline}/>
		<span>{getLabel()}</span>
	</dt>
	<dd class="dusk-status-list__value stake-overview__value">
		<span>{duskFormatter(amount)}</span>
		<Icon
			path={logo}
			data-tooltip-id="status-tooltip"
			data-tooltip-text="DUSK"
			data-tooltip-place="top"
		/>
	</dd>
</dl>

<style lang="postcss">
	.stake-overview {
		display: flex;
		flex-direction: column;
		gap: 0.625em;

		&__value {
			justify-content: flex-start;
		}
	}
</style>
