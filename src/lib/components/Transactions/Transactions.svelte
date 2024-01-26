<script>
	import { mdiArrowLeft, mdiContain } from "@mdi/js";
	import { fade } from "svelte/transition";
	import { logo } from "$lib/dusk/icons";
	import {
		Anchor, AnchorButton, Badge, Card, Icon, Throbber, Tooltip
	} from "$lib/dusk/components";
	import { createFeeFormatter, createTransferFormatter } from "$lib/dusk/currency";
	import { settingsStore, walletStore } from "$lib/stores";
	import { calculateAdaptiveCharCount, middleEllipsis } from "$lib/dusk/string";
	import { onMount } from "svelte";
	import { sortByHeightDesc } from "$lib/transactions";
	import { compose, take } from "lamb";

	const { language, dashboardTransactionLimit } = $settingsStore;
	const transferFormatter = createTransferFormatter(language);
	const feeFormatter = createFeeFormatter(language);

	/** @type {Number} */
	let screenWidth = window.innerWidth;

	/** @type {(transactions: Transaction[]) => Transaction[]} */
	const getTransactionsShortlist = compose(
		take(dashboardTransactionLimit),
		sortByHeightDesc
	);

	export let isOnDashboard = false;

	onMount(() => {
		const resizeObserver = new ResizeObserver(entries => {
			const entry = entries[0];

			screenWidth = entry.contentRect.width;
		});

		resizeObserver.observe(document.body);

		return () => resizeObserver.disconnect();
	});

</script>

<article in:fade|global class="transactions">
	<header class="transactions__header">
		<h3 class="h4">Transactions</h3>
	</header>

	{#await walletStore.getTransactionsHistory()}
		<Throbber className="loading"/>
	{:then transactions}
		<div class="transactions__lists">
			{#if transactions.length}
				{@const sortedTransactions = isOnDashboard
					? getTransactionsShortlist(transactions) : sortByHeightDesc(transactions)}
				{#each sortedTransactions as transaction (transaction.id)}
					<dl class="transactions-list">
						<dt class="transactions-list__term">Hash</dt>
						<dd class="transactions-list__datum transactions-list__datum--hash">
							<samp>
								<Anchor
									href="https://explorer.dusk.network/transactions/transaction?id={transaction.id}"
									rel="noopener noreferrer"
									target="_blank"
								>
									{middleEllipsis(
										transaction.id,
										calculateAdaptiveCharCount(screenWidth, 320, 640, 5, 20)
									)}
								</Anchor>
							</samp>
						</dd>
						{#if transaction.tx_type}
							<dt class="transactions-list__term">Type</dt>
							<dd class="transactions-list__datum">
								<Badge className="w-100" text={transaction.tx_type}/>
							</dd>
						{/if}
						<dt class="transactions-list__term">Block</dt>
						<dd class="transactions-list__datum">
							{new Intl.NumberFormat(language).format(transaction.block_height)}
						</dd>
						<dt class="transactions-list__term">Amount</dt>
						<dd class="transactions-list__datum">
							{transferFormatter(transaction.amount)}
							<Icon
								className="transactions-list__icon"
								path={logo}
								data-tooltip-id="transactions-tooltip"
								data-tooltip-text="DUSK"
								data-tooltip-place="top"
							/>
						</dd>
						{#if transaction.direction === "Out"}
							<dt class="transactions-list__term">Fee</dt>
							<dd class="transactions-list__datum">
								{feeFormatter(transaction.fee)}
								<Icon
									className="transactions-list__icon"
									path={logo}
									data-tooltip-id="transactions-tooltip"
									data-tooltip-text="DUSK"
									data-tooltip-place="top"
								/>
							</dd>
						{/if}
					</dl>
				{/each}
			{:else}
				<div class="transactions-list__empty">
					<Icon path={mdiContain} size="large"/>
					<p>You have no transaction history</p>
				</div>
			{/if}
		</div>

	{:catch e}
		<Card heading="Error getting transactions">
			<pre>{e}</pre>
		</Card>
	{/await}

	<footer class="transactions__footer">
		{#if isOnDashboard}
			<AnchorButton
				className="transactions__footer-button"
				href="/dashboard/transactions"
				text="View all transactions"
				variant="tertiary"
			/>
		{:else}
			<AnchorButton
				className="transactions__footer-button"
				href="/dashboard"
				text="Back"
				variant="tertiary"
				icon={{ path: mdiArrowLeft }}
			/>
		{/if}
	</footer>
</article>

<Tooltip id="transactions-tooltip"/>

<style lang="postcss">
.transactions {
	border-radius: 1.25em;
	background: var(--surface-color);
	height: 100%;
	display: flex;
	flex-direction: column;
	overflow: hidden;

	&__header {
		padding: 1.375em 1em;
		& :global(h3) {
			line-height: 150%;
		}
	}

	&__lists {
		display: flex;
		flex-direction: column;
		gap: 0.625em;
		flex: 1;
		overflow-y: scroll;
	}

	&__footer {
		padding: 1em 1.375em;
		display: flex;
		margin-top: auto;
	}

	:global(.transactions__footer-button) {
		width: 100%;
	}

	:global(.loading) {
		width: 100%;
		align-self: center;
	}
}
.transactions-list {
	display: grid;
	grid-template-columns: max-content auto;

	&__term {
		background-color: var(--background-color-alt);
		grid-column: 1;
		line-height: 130%;
		text-transform: capitalize;
		padding: .3125em .625em .3125em 1.375em;
	}

	&__datum {
		grid-column: 2;
		line-height: 150%;
		padding: .312em .625em;
		display: flex;
		align-items: center;
		gap: 0.625em;
		font-family: var(--mono-font-family);
		overflow: hidden;

		& samp {
			display: block;
			white-space: nowrap;
			overflow: hidden;
		}

		&--hash {
			justify-content: center;
		}
	}

	&__empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5em;
	}

	:global(&__badge) {
		flex: 1;
	}

	& dt:first-of-type, & dd:first-of-type {
		padding-top: 1em;
	}

	& dt:last-of-type, & dd:last-of-type {
		padding-bottom: 1em;
	}

	& dt:first-of-type {
		border-top-right-radius: 2em;
	}

	& dt:last-of-type {
		border-bottom-right-radius: 2em;
	}
}
</style>
