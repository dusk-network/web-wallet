<script>
	import {
		mdiArrowDownBoldBoxOutline,
		mdiArrowUpBoldBoxOutline,
		mdiContain,
		mdiDatabaseArrowDownOutline,
		mdiDatabaseArrowUpOutline
	} from "@mdi/js";
	import { fade } from "svelte/transition";
	import { logo } from "$lib/dusk/icons";
	import { makeClassName } from "$lib/dusk/string";
	import { Badge, Icon, Tooltip } from "$lib/dusk/components";
	import { createCurrencyFormatter, createTransferFormatter } from "$lib/dusk/currency";
	import { settingsStore } from "$lib/stores";

	/** @type Transaction[] */
	export let transactions;

	/** @type {String | Undefined} */
	export let className = undefined;

	$: classes = makeClassName(["transactions", className]);

	const { language } = $settingsStore;
	const feeFormatter = createCurrencyFormatter(language, "DUSK");
	const transferFormatter = createTransferFormatter(language);
</script>

<article in:fade|global class={classes}>
	<header class="transactions__header">
		<slot name="heading"/>
	</header>

	<div class="transactions__lists">
		{#if transactions.length}
			{#each transactions as transaction (transaction.hash)}
				{@const isPositive = Math.sign(transaction.amount) === 1}
				<dl class="transactions-list">
					<dt class="transactions-list__term">Hash</dt>
					<dd class="transactions-list__datum">
						<samp>{transaction.hash}</samp>
					</dd>
					<dt class="transactions-list__term">Method</dt>
					<dd class="transactions-list__datum">
						<Badge className="transactions-list__badge" text={transaction.method}/>
						{#if Math.sign(transaction.amount) !== 0}
							{#if transaction.method === "transfer"}
								<Icon
									path={
										isPositive ? mdiArrowDownBoldBoxOutline : mdiArrowUpBoldBoxOutline
									}/>
							{/if}
							{#if transaction.method === "stake"}
								<Icon
									path={
										isPositive ? mdiDatabaseArrowDownOutline : mdiDatabaseArrowUpOutline
									}/>
							{/if}
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
		{:else}
			<div class="transactions-list__empty">
				<Icon path={mdiContain} size="large"/>
				<p>No transactions to show yet.</p>
			</div>
		{/if}
	</div>

	<footer class="transactions__footer">
		{#if transactions.length}
			<slot name="controls"/>
		{/if}
	</footer>
</article>

<Tooltip id="transactions-tooltip"/>

<style lang="postcss">
.transactions {
	border-radius: 1.25em;
	background: var(--surface-color);

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
	}

	&__footer {
		display: flex;
		padding: 1em 1.375em;
		justify-content: space-between;
		gap: 0.625em;
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
		min-width: 0;
		max-width: 100%;

		& samp {
			display: block;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			min-width: 0;
			max-width: 100%;
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
