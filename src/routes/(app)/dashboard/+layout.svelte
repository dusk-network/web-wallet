<script>
	import {
		mdiAlertOutline,
		mdiCogOutline,
		mdiLink,
		mdiRestore,
		mdiTimerSand
	} from "@mdi/js";

	import {
		AnchorButton,
		Button,
		Icon,
		ProgressBar
	} from "$lib/dusk/components";
	import { settingsStore, walletStore } from "$lib/stores";

	$: ({ network } = $settingsStore);
	$: ({ isSyncing, error } = $walletStore);

	/** @type {String} */
	let syncStatus = "";

	/** @type {String} */
	let iconPath = "";

	/** @type {String} */
	let iconVariant = "";

	$: if (isSyncing) {
		iconVariant = "sync";
		iconPath = mdiTimerSand;
		syncStatus = `Syncing with Dusk ${network}`;
	} else if (error) {
		iconVariant = "error";
		iconPath = mdiAlertOutline;
		syncStatus = `Dusk ${network} - Sync Failed`;
	} else {
		iconVariant = "success";
		iconPath = mdiLink;
		syncStatus = `Dusk ${network}`;
	}
</script>

<svelte:window on:beforeunload={event => { event.preventDefault(); }}/>

<section class="dashboard">
	<slot/>
	<footer class="footer">
		<nav class="footer__navigation">
			<div class="footer__network-status">
				<span
					class={`footer__icon-wrapper footer__icon-wrapper--${iconVariant}`}
					data-tooltip-disabled={!error}
					data-tooltip-id="main-tooltip"
					data-tooltip-text={error?.message}
					data-tooltip-type="error"
				>
					<Icon
						className="footer__icon"
						path={iconPath}
						size="normal"
					/>
				</span>

				<div class="footer__network-message">
					<span>{syncStatus}</span>
					{#if isSyncing}
						<ProgressBar/>
					{/if}
				</div>
			</div>
			<div class="footer__actions">
				{#if error}
					<Button
						aria-label="Retry syncronization"
						className="footer__actions-button"
						data-tooltip-id="main-tooltip"
						data-tooltip-text="Retry syncronization"
						icon={{ path: mdiRestore, size: "large" }}
						on:click={() => { walletStore.sync(); }}
						variant="text"
					/>
				{/if}
				<AnchorButton
					variant="text"
					className="footer__anchor-button"
					icon={{ path: mdiCogOutline, size: "large" }}
					href="/settings"
					aria-label="Settings"
					data-tooltip-id="main-tooltip"
					data-tooltip-text="Settings"
				/>
			</div>
		</nav>
	</footer>
</section>

<style lang="postcss">
	.dashboard {
		position: relative;
		display: flex;
		align-content: space-between;
		gap: 1.375rem;
		flex: 1;
		flex-direction: column;
		overflow: hidden;
	}

	.footer {
		width: 100%;

		&__navigation {
			display: flex;
			justify-content: space-between;
			gap: 0.75rem;
			align-items: center;
			width: 100%;
		}

		&__actions {
			display: flex;
			flex-direction: row;
			gap: 0.75em;
			align-items: center;
		}

		&__network-status {
			display: flex;
			align-items: center;
			gap: var(--small-gap);
			line-height: 150%;
			text-transform: capitalize;

			&__network-message {
				display: flex;
				align-items: center;
			}
		}

		&__icon-wrapper {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 1.625em;
			height: 1.625em;
			border-radius: 100%;

			:global(&--success) {
				background-color: var(--success-color);
			}

			:global(&--sync) {
				background-color: var(--warning-color);
			}

			:global(&--error) {
				background-color: var(--error-color);
				cursor: help;

				:global(.footer__icon) {
					color: var(--footer-icon-color);
				}
			}
		}
	}
</style>
