<svelte:options immutable={true}/>

<script>
	import { mdiApplicationCogOutline, mdiArrowLeftCircleOutline } from "@mdi/js";
	import { AnchorButton, Icon, Select } from "$lib/dusk/components";
	import { currencies } from "$lib/dusk/currency";
	import { settingsStore } from "$lib/settings";
	import { mapWith, rename } from "lamb";

	/** @type {(currency: { code: string, currency: string }) => SelectOption} */
	const currencyToOption = rename({ code: "value", currency: "label" });
	const currenciesToOptions = mapWith(currencyToOption);
	const { currency } = $settingsStore;
</script>

<section class="settings">
	<header class="settings__header">
		<AnchorButton href="/dashboard" icon={{ path: mdiArrowLeftCircleOutline }} variant="text"/>
		<h2>
			Settings
		</h2>
	</header>
	<hr/>
	<article class="settings-group">
		<header class="settings-group__header">
			<Icon path={mdiApplicationCogOutline}/>
			<h3 class="h4">Preferences</h3>
		</header>
		<Select
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
	</article>
	<hr/>
</section>

<style lang="postcss">
	.settings {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1rem;

		&__header {
			display: flex;
			align-items: center;
			gap: 0.5rem;
		}
	}

	.settings-group {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;

		&__header {
			display: flex;
			align-items: center;
			gap: 0.75rem;
		}
	}

</style>
