<svelte:options immutable={true}/>

<script>
	import { fade } from "svelte/transition";
	import TermsOfService from "../TermsOfService.svelte";

	// Steps
	import PasswordSetup from "../PasswordSetup.svelte";
	import AllSet from "../AllSet.svelte";
	import MnemonicAuthenticate from "./MnemonicAuthenticate.svelte";
	import { Wizard, WizardStep } from "$lib/dusk/components";
	import { enteredMnemonicPhrase, mnemonicPhrase } from "$lib/dusk/components/Mnemonic/store";
	import { encryptMnemonic, getSeedFromMnemonic } from "$lib/wallet";
	import loginInfoStorage from "$lib/services/loginInfoStorage";
	import { goto } from "$app/navigation";
	import { getWallet } from "$lib/services/wallet";
	import { settingsStore, walletStore } from "$lib/stores";

	let tosAccepted = false;

	// Password
	let password = "";
	let validPassword = false;
	let showPasswordSetup = false;

	const resetPassword = () => {
		password = showPasswordSetup ? password : "";
	};

	// eslint-disable-next-line
	$: showPasswordSetup, resetPassword();

	// Mnemonic
	let validMnemonic = false;

	async function refreshLocalStoragePasswordInfo () {
		loginInfoStorage.remove();

		if (password.length !== 0 && validPassword) {
			const mnemonic = $mnemonicPhrase.join(" ");
			const encryptedData = await encryptMnemonic(mnemonic, password);

			loginInfoStorage.set(encryptedData);
		}
	}

	async function initializeWallet () {
		settingsStore.reset();

		const mnemonic = $mnemonicPhrase.join(" ");
		const seed = getSeedFromMnemonic(mnemonic);
		const wallet = await getWallet(seed);

		await walletStore.clearLocalDataAndInit(wallet);
	}

	$: if (validMnemonic) {
		mnemonicPhrase.set($enteredMnemonicPhrase);
	}
</script>

{#if !tosAccepted}
	<div class="onboarding-wrapper" in:fade|global>
		<TermsOfService bind:tosAccepted/>
	</div>
{:else}
	<Wizard fullHeight={true} steps={3} let:key>
		<WizardStep
			step={0}
			{key}
			showStepper={true}
			backButton={{
				disabled: false,
				href: "/setup",
				isAnchor: true
			}}
			nextButton={{
				action: initializeWallet,
				disabled: !validMnemonic
			}}>
			<h2 class="h1" slot="heading">
				Enter<br/>
				<mark>Mnemonic Phrase</mark>
			</h2>
			<MnemonicAuthenticate bind:isValid={validMnemonic}/>
		</WizardStep>
		<WizardStep
			step={1}
			{key}
			showStepper={true}
			nextButton={{
				action: async () => {
					await refreshLocalStoragePasswordInfo();
				},
				disabled: !validPassword
			}}
		>
			<h2 class="h1" slot="heading">
				<mark>Password</mark><br/>
				Setup
			</h2>
			<PasswordSetup bind:password bind:isValid={validPassword} bind:isToggled={showPasswordSetup}/>
		</WizardStep>
		<WizardStep
			step={2}
			{key}
			showStepper={true}
			hideBackButton={true}
			nextButton={{
				action: async () => {
					mnemonicPhrase.set([]);
					await goto("/dashboard");
				},
				disabled: false
			}}>
			<h2 class="h1" slot="heading">
				Welcome to<br/>
				<mark>Dusk</mark>
			</h2>
			<AllSet/>
		</WizardStep>
	</Wizard>
{/if}

<style>
	.onboarding-wrapper {
		height: 100%;
		overflow-y: auto;
	}
</style>
