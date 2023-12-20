<script>
	import { fade } from "svelte/transition";
	import { logo } from "$lib/dusk/icons";
	import {
		Badge,
		Button,
		Icon,
		StatusList,
		Textbox,
		Wizard,
		WizardStep
	} from "$lib/dusk/components";
	import { createCurrencyFormatter } from "$lib/dusk/currency";
	import { mdiArrowUpBoldBoxOutline, mdiWalletOutline } from "@mdi/js";
	import { operationsStore, settingsStore, walletStore } from "$lib/stores";
	import GasSettings from "./GasSettings/GasSettings.svelte";
	import TransactionComplete from "./TransactionComplete/TransactionComplete.svelte";
	import ScanQR from "./ScanQR/ScanQR.svelte";

	/** @type {Status[]} */
	export let statuses;

	/** @type {Number} */
	let amount = 1;

	/** @type {String} */
	let address = "";

	const duskFormatter = createCurrencyFormatter("en", "DUSK");
	const resetOperationStore = () => {
		operationsStore.update((store) => ({
			...store,
			currentOperation: undefined
		}));
	};

	$: ({
		gasLimit,
		gasLimitLower,
		gasLimitUpper,
		gasPrice,
		gasPriceLower
	} = $settingsStore);
</script>

<div class="operation">
	<Wizard steps={4} let:key>
		<WizardStep
			step={0}
			{key}
			backButton={{
				action: () => resetOperationStore(),
				disabled: false
			}}
			nextButton={{
				disabled: amount === 0
			}}
		>
			<div in:fade|global class="operation__send">
				<StatusList {statuses}/>
				<div class="operation__send-amount operation__space-between">
					<p>Enter amount:</p>
					<Button
						size="small"
						variant="tertiary"
						on:click={() => {
							const { balance } = $walletStore;

							amount = balance.maximum;
						}}
						text="USE MAX"
					/>
				</div>

				<div class="operation__send-amount operation__input">
					<Textbox
						className="operation__input-field"
						type="number"
						bind:value={amount}
					/>
					{#if statuses[0]?.value?.icon}
						<Icon
							className="dusk-status__icon"
							path={statuses[0].value.icon.path ?? ""}
							data-tooltip-id={statuses[0].value.icon.label
								&& "status-tooltip"}
							data-tooltip-text={statuses[0].value.icon.label
								?? ""}
							data-tooltip-place="top"
						/>
					{/if}
				</div>
			</div>
		</WizardStep>
		<WizardStep
			step={1}
			{key}
			nextButton={{ disabled: address.length === 0 }}
		>
			<div in:fade|global class="operation__send">
				<div class="operation__send-amount operation__space-between">
					<p>Enter address:</p>

					<ScanQR
						on:scan={(event) => {
							address = event.detail;
						}}
					/>
				</div>
				<Textbox
					className="operation__send-address"
					type="multiline"
					bind:value={address}
				/>
			</div>
		</WizardStep>
		<WizardStep
			step={2}
			{key}
			nextButton={{
				icon: { path: mdiArrowUpBoldBoxOutline, position: "before" },
				label: "SEND",
				variant: "secondary"
			}}
		>
			<div in:fade|global class="operation__send">
				<Badge
					className="operation__review-notice"
					text="REVIEW TRANSACTION"
					variant="warning"
				/>

				<dl class="operation__review-transaction">
					<dt class="dusk-status-list__key">
						<Icon path={mdiArrowUpBoldBoxOutline}
						/>
						<span>Amount:</span>
					</dt>
					<dd class="dusk-status-list__value operation__review-amount"
					>
						<span>
							{duskFormatter(amount)}
						</span>
						<Icon
							className="dusk-amount__icon"
							path={logo}
							data-tooltip-id="status-tooltip"
							data-tooltip-text="DUSK"
							data-tooltip-place="top"
						/>
					</dd>
				</dl>

				<dl class="operation__review-transaction">
					<dt class="dusk-status-list__key">
						<Icon path={mdiWalletOutline}/>
						<span>To:</span>
					</dt>
					<dd class="operation__review-address">
						<span>{address}</span>
					</dd>
				</dl>
				<GasSettings
					limit={gasLimit}
					limitLower={gasLimitLower}
					limitUpper={gasLimitUpper}
					price={gasPrice}
					priceLower={gasPriceLower}
					on:setGasSettings={(event) => {
						settingsStore.update(store => {
							store.gasLimit = event.detail.limit;
							store.gasPrice = event.detail.price;

							return store;
						});
					}}
				/>
			</div>
		</WizardStep>
		<WizardStep step={3} {key} showNavigation={false}>
			<TransactionComplete/>
		</WizardStep>
	</Wizard>
</div>

<style lang="postcss">
	.operation {
		&__review-address {
			background-color: transparent;
			border: 1px solid var(--primary-color);
			border-radius: 1.5em;
			padding: 0.75em 1em;
			width: 100%;
			line-break: anywhere;
		}

		&__review-transaction {
			display: flex;
			flex-direction: column;
			gap: 0.625em;
		}

		&__review-amount {
			justify-content: flex-start;
		}

		&__send {
			display: flex;
			flex-direction: column;
			gap: 1.2em;
		}

		&__send-amount {
			display: flex;
			align-items: center;
			width: 100%;
		}

		&__space-between {
			justify-content: space-between;
		}

		&__input {
			column-gap: var(--default-gap);
		}

		:global(&__input &__input-field) {
			width: 100%;
			padding: 0.5em 1em;
		}

		:global(&__send-address) {
			width: 100%;
		}

		:global(&__review-notice) {
			text-align: center;
		}

		:global(.dusk-amount__icon) {
			width: 1em;
			height: 1em;
			flex-shrink: 0;
		}
	}
</style>
