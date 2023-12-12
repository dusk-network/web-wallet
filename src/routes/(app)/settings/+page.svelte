<svelte:options immutable={true}/>

<script>
	import {
		mdiApplicationCogOutline,
		mdiArrowLeft,
		mdiCheckNetworkOutline,
		mdiFileDownloadOutline,
		mdiGasStationOutline,
		mdiRestoreAlert,
		mdiWalletOutline
	} from "@mdi/js";
	import {
		AnchorButton, Button, Icon, Select, Switch, Textbox
	} from "$lib/dusk/components";
	import { currencies } from "$lib/dusk/currency";
	import { settingsStore } from "$lib/stores";
	import { mapWith, rename } from "lamb";
	import Badge from "$lib/dusk/components/Badge/Badge.svelte";

	/** @type {(currency: { code: string, currency: string }) => SelectOption} */
	const currencyToOption = rename({ code: "value", currency: "label" });
	const currenciesToOptions = mapWith(currencyToOption);
	const { currency, darkMode, network } = $settingsStore;
	const networks = ["testnet", "mainnet"];

	let isDarkMode = darkMode;
</script>

<section class="settings">
	<header class="settings__header">
		<h2>Settings</h2>
	</header>

	<div class="settings__content">
		<hr/>
		<article class="settings-group">
			<header class="settings-group__header settings-group__header--network">
				<div class="settings-group__header">
					<Icon path={mdiCheckNetworkOutline}/>
					<h3 class="h4 settings-group__heading">Network Status</h3>
				</div>
				<Badge variant="success" text="Online"/>
			</header>
			<Select
				className="settings-group__select"
				value={network}
				on:change={(evt) => {
					settingsStore.update(store => {
						// eslint-disable-next-line no-extra-parens
						const option = /** @type {HTMLInputElement} */ (evt.target);

						store.network = option.value;

						return store;
					});
				}}
				options={networks}
			/>
		</article>
		<hr/>
		<article class="settings-group">
			<header class="settings-group__header">
				<Icon path={mdiWalletOutline}/>
				<h3 class="h4 settings-group__heading">Wallet</h3>
			</header>

			<div class="settings-group__multi-control-content">
				<div class="settings-group__control settings-group__control--with-label">
					<span>Wallet Recovery File</span>
					<Button
						on:click={() => { return true; }}
						icon={{ path: mdiFileDownloadOutline }}
						text="Export"
						variant="secondary"
					/>
				</div>
				<div class="settings-group__control settings-group__control--with-label">
					<span>Key Pair File</span>
					<Button
						on:click={() => { return true; }}
						icon={{ path: mdiFileDownloadOutline }}
						text="Export"
						variant="secondary"
					/>
				</div>
			</div>
		</article>
		<hr/>
		<article class="settings-group">
			<header class="settings-group__header">
				<Icon path={mdiGasStationOutline}/>
				<h3 class="h4 settings-group__heading">Gas Settings</h3>
			</header>
			<div class="settings-group__multi-control-content">
				<label for={undefined} class="settings-group__control settings-group__control--with-label">
					<span>Minimum gas</span>
					<Textbox placeholder="minimum gas value" type="number" min="0"/>
				</label>
				<label for={undefined} class="settings-group__control settings-group__control--with-label">
					<span>Maximum gas</span>
					<Textbox placeholder="maximum gas value" type="number" min="0"/>
				</label>
			</div>
		</article>
		<hr/>
		<article class="settings-group">
			<header class="settings-group__header">
				<Icon path={mdiApplicationCogOutline}/>
				<h3 class="h4 settings-group__heading">Preferences</h3>
			</header>
			<div class="settings-group__multi-control-content">
				<label class="settings-group__control settings-group__control--switch" for={undefined}>
					<span>Dark Mode</span>
					<Switch
						bind:value={isDarkMode}
						on:change={() => {
							settingsStore.update(store => {
								store.darkMode = isDarkMode;

								return store;
							});
						}}
					/>
				</label>
				<label class="settings-group__control settings-group__control--with-label" for={undefined}>
					<span>Default currency</span>
					<Select
						className="settings-group__control settings-group__control--with-label"
						value={currency}
						on:change={(evt) => {
							settingsStore.update(store => {
								// eslint-disable-next-line no-extra-parens
								const option = /** @type {HTMLInputElement} */ (evt.target);

								store.currency = option.value;

								return store;
							});
						}}
						options={currenciesToOptions(currencies)}
					/>
				</label>
			</div>
		</article>
		<hr/>
		<article class="settings-group">
			<header class="settings-group__header">
				<Icon path={mdiRestoreAlert}/>
				<h3 class="h4 settings-group__heading">Initialize Wallet</h3>
			</header>
			<Button
				className="settings-group__button--state--danger"
				on:click={() => { return true; }}
				text="Reset Wallet"
				variant="secondary"
			/>
		</article>
	</div>
</section>

<div class="settings-actions">
	<AnchorButton
		href="/dashboard"
		icon={{ path: mdiArrowLeft }}
		variant="tertiary"
		text="Back"/>
	<Button variant="tertiary" text="Log out"/>
</div>

<style lang="postcss">
	.settings {
		overflow: hidden;
		background-color: var(--surface-color);
		border-radius: 1.125em;
		padding: 1em 1em 0 1em;

		&, &__content {
			display: flex;
			flex-direction: column;
			gap: var(--default-gap);
		}

		&__content {
			overflow-y: auto;
		}

		:global(& button, & select, & a) {
			width: 100%;
		}
	}

	.settings-group {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--small-gap);
		width: 100%;
		margin-bottom: .5em;

		&__header {
			display: flex;
			align-items: center;
			gap: 0.75em;

			&--network {
				width: 100%;
				justify-content: space-between;
			}
		}

		&__heading {
			line-height: 140%;
		}

		&__control {
			align-items: center;
			display: flex;
			flex-direction: row;
			justify-content: space-between;
			gap: .5em;
			width: 100%;

			&--with-label {
				flex-direction: column;
				justify-content: start;
				align-items: stretch;

				& > span {
					line-height: 140%;
				}
			}

			&--switch {
				background-color: var(--on-primary-color);
				padding: 0.625em 0.75em 0.625em 0.75em;
				border-radius: 1.5em;
			}
		}

		&__multi-control-content {
			display: flex;
			flex-direction: column;
			gap: var(--default-gap);
			width: 100%;
		}

		:global(&__select) {
			text-transform: uppercase;
		}

		&:last-of-type {
			margin-bottom: 1em;
		}
	}

	.settings-actions {
		display: flex;
		flex-direction: row;
		justify-content: space-between;
		gap: var(--default-gap);

		:global(& button, & a) {
			width: 100%;
		}
	}

	:global(.dusk-button.settings-group__button--state--danger) {
		background-color: var(--danger-color);
	}
</style>
