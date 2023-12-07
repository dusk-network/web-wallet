<script>
	import { fade } from "svelte/transition";
	import { logo } from "$lib/dusk/icons";
	import { Badge, Icon, Tooltip } from "$lib/dusk/components";
	import { createCurrencyFormatter, createTransferFormatter } from "$lib/dusk/currency";
	import { settingsStore } from "$lib/stores";

	/** @type Transaction[] */
	export let transactions;

	const { language } = $settingsStore;
	const feeFormatter = createCurrencyFormatter(language, "DUSK");
	const transferFormatter = createTransferFormatter(language);
</script>

<article in:fade|global class="transactions">
	<header class="transactions__header">
		<slot name="heading"/>
	</header>

	<div class="transactions__lists">
		{#each transactions as transaction (transaction.hash)}
			<dl class="transactions-list">
				<dt class="transactions-list__term">Hash</dt>
				<dd class="transactions-list__datum">
					<samp>{transaction.hash}</samp>
				</dd>
				<dt class="transactions-list__term">Method</dt>
				<dd class="transactions-list__datum">
					<Badge text={transaction.method.split(" ")[0]}/>
					{#if transaction.method === "transfer" && Math.sign(transaction.amount) !== 0}
						<Badge
							text={Math.sign(transaction.amount) === 1 ? "Received" : "Sent"}
							variant={Math.sign(transaction.amount) === 1 ? "success" : "error"}
						/>
					{/if}
				</dd>
				<dt class="transactions-list__term">Block</dt>
				<dd class="transactions-list__datum">
					{new Intl.NumberFormat(language).format(transaction.block)}
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
			</dl>
		{/each}
	</div>

	<footer class="transactions__footer">
		<slot name="controls"/>
	</footer>
</article>

<Tooltip id="transactions-tooltip"/>

<style lang="postcss">
.transactions {
	border-radius: 1.25rem;
	background: var(--surface-color);

	&__header {
		padding: 1.375rem 1rem;
		& :global(h3) {
			line-height: 150%;
		}
	}

	&__lists {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		overflow-y: scroll;
	}

	&__footer {
		display: flex;
		padding: 1rem 1.375rem;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		gap: 0.625rem;
		align-self: stretch;
	}
}

.transactions-list {
	display: grid;
	grid-template-columns: max-content auto;

	&__term {
		background-color: var(--background-color-alt);
		grid-column: 1;
		text-align: center;
		line-height: 130%;
		text-transform: capitalize;
		padding: .3125rem 1.375rem;
	}

	&__datum{
		grid-column: 2;
		line-height: 150%;
		padding: .312rem 1.375rem;
		overflow-x: scroll;
		display: flex;
		align-items: center;
		gap: 0.625rem;
		font-family: var(--mono-font-family);

		& samp {
			max-width: 100%;
			white-space: nowrap;
			text-overflow: ellipsis;

		}
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
