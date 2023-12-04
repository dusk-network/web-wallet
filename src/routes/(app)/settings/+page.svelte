<svelte:options immutable={true}/>

<script>
	import {
		mdiApplicationCogOutline,
		mdiArrowLeftCircleOutline,
		mdiCheckCircleOutline,
		mdiCheckNetworkOutline,
		mdiFileDownloadOutline,
		mdiFileExportOutline,
		mdiGasStationOutline,
		mdiRestoreAlert
	} from "@mdi/js";
	import {
		AnchorButton, Button, Icon, Select, Switch, Textbox
	} from "$lib/dusk/components";
	import { currencies } from "$lib/dusk/currency";
	import { settingsStore } from "$lib/stores";
	import { mapWith, rename } from "lamb";

	/** @type {(currency: { code: string, currency: string }) => SelectOption} */
	const currencyToOption = rename({ code: "value", currency: "label" });
	const currenciesToOptions = mapWith(currencyToOption);
	const { currency, darkMode, network } = $settingsStore;
	const networks = ["testnet", "mainnet"];

	let isDarkMode = darkMode;
</script>

<section class="settings">
	<header class="settings__header">
		<AnchorButton
			href="/dashboard"
			icon={{ path: mdiArrowLeftCircleOutline, size: "large" }}
			variant="text"/>
		<h2>
			Settings
		</h2>
	</header>
	<hr/>
	<div class="settings__content">
		<article class="settings-group">
			<header class="settings-group__header">
				<Icon path={mdiCheckNetworkOutline}/>
				<h3 class="h4 settings-group__heading">Network</h3>
			</header>
			<label class="settings-group__control" for={undefined}>
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
				<span class="settings__network-status">
					ONLINE
					<Icon className="settings__network-status-icon" path={mdiCheckCircleOutline}/>
				</span>

			</label>
		</article>
		<hr/>
		<article class="settings-group">
			<header class="settings-group__header">
				<Icon path={mdiFileExportOutline}/>
				<h3 class="h4 settings-group__heading">Export</h3>
			</header>
			<Button
				on:click={() => { return true; }}
				icon={{ path: mdiFileDownloadOutline }}
				text="Wallet Recovery File"
				variant="secondary"
			/>
			<Button
				on:click={() => { return true; }}
				icon={{ path: mdiFileDownloadOutline }}
				text="Key Pair File"
				variant="secondary"
			/>
		</article>
		<hr/>
		<article class="settings-group">
			<header class="settings-group__header">
				<Icon path={mdiGasStationOutline}/>
				<h3 class="h4 settings-group__heading">Gas</h3>
			</header>
			<label for={undefined} class="settings-group__control settings-group__control--with-label">
				<Textbox placeholder="minimum gas value" type="number" min="0"/>
				<span>Minimum gas</span>
			</label>
			<label for={undefined} class="settings-group__control settings-group__control--with-label">
				<Textbox placeholder="maximum gas value" type="number" min="0"/>
				<span>Maximum gas</span>
			</label>
		</article>
		<hr/>
		<article class="settings-group">
			<header class="settings-group__header">
				<Icon path={mdiApplicationCogOutline}/>
				<h3 class="h4 settings-group__heading">Preferences</h3>
			</header>
			<label class="settings-group__control" for={undefined}>
				<span>Dark mode:</span>
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
				<span>Default currency</span>
			</label>
		</article>
		<hr/>
		<article class="settings-group">
			<header class="settings-group__header">
				<Icon path={mdiFileExportOutline}/>
				<h3 class="h4 settings-group__heading">Danger Zone!</h3>
			</header>
			<Button
				className="settings-group__button--state--danger"
				on:click={() => { return true; }}
				icon={{ path: mdiRestoreAlert }}
				text="Reset Wallet"
				variant="secondary"
			/>
		</article>
	</div>
</section>

<style lang="postcss">
	.settings {
		overflow: hidden;

		&, &__content {
			display: flex;
			flex-direction: column;
			gap: var(--default-gap);
		}

		&__content {
			overflow-y: auto;
		}

		&__header {
			display: flex;
			align-items: center;
			gap: var(--small-gap);
		}

		&__network-status {
			color: var(--success-color);
			display: flex;
			align-items: center;
			gap: var(--small-gap);
		}
	}

	.settings-group {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--small-gap);
		width: 100%;

		&__header {
			display: flex;
			align-items: center;
			gap: 0.75em;
		}

		&__heading {
			line-height: 140%;
		}

		&__control {
			align-items: center;
			display: flex;
			flex-direction: row;
			justify-content: space-between;
			gap: .75em;
			width: 100%;

			&--with-label {
				flex-direction: column;
				justify-content: start;
				align-items: stretch;

				& > span {
					line-height: 140%;
					text-align: right;

					@media (min-width: 768px) {
						text-align: left;
					}
				}

				@media (min-width: 768px) {
					flex-direction: row;
					align-items: center;
				}
			}
		}

		:global(&__select) {
			text-transform: uppercase;
		}
	}

	:global(.dusk-button.settings-group__button--state--danger) {
		background-color: var(--danger-color);
	}

	:global(.dusk-icon.settings__network-status-icon) {
		fill: var(--success-color);
	}

</style>
