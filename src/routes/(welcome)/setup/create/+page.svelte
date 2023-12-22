<svelte:options immutable={true}/>

<script>
	import { fade } from "svelte/transition";
	import { encryptMnemonic, getSeedFromMnemonic } from "$lib/wallet";
	import { mnemonicPhrase } from "$lib/dusk/components/Mnemonic/store";
	import { Wizard } from "$lib/dusk/components";
	import loginInfoStorage from "$lib/services/loginInfoStorage";

	import TermsOfService from "../TermsOfService.svelte";

	// Steps
	import MnemonicPhrase from "./MnemonicPhrase.svelte";
	import ValidateMnemonic from "./ValidateMnemonic.svelte";
	import SwapNDUSK from "./SwapNDUSK.svelte";
	import AllSet from "../AllSet.svelte";
	import WizardStep from "$lib/dusk/components/Wizard/WizardStep.svelte";
	import MnemonicPreSetup from "./MnemonicPreSetup.svelte";
	import PasswordSetup from "../PasswordSetup.svelte";
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

	// Notice
	let agreementAccepted = false;

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
</script>

{#if !tosAccepted}
	<div class="onboarding-wrapper" in:fade|global>
		<TermsOfService bind:tosAccepted/>
	</div>
{:else}
	<Wizard fullHeight={true} steps={6} let:key>
		<!--  MNEMONIC PRE-SETUP -->
		<WizardStep
			step={0}
			{key}
			showStepper={true}
			backButton={{
				disabled: false,
				href: "/setup",
				isAnchor: true
			}}
			nextButton={{ disabled: !agreementAccepted }}
		>
			<h2 class="h1" slot="heading">
				Backup<br/>
				<mark>Mnemonic Phrase</mark>
			</h2>
			<MnemonicPreSetup bind:isValid={agreementAccepted}/>
		</WizardStep>
		<!--  BACKUP MNEMONIC -->
		<WizardStep
			step={1}
			{key}
			showStepper={true}
		>
			<h2 class="h1" slot="heading">
				Backup<br/>
				<mark>Mnemonic Phrase</mark>
			</h2>
			<MnemonicPhrase/>
		</WizardStep>
		<!--  VALIDATE MNEMONIC -->
		<WizardStep
			step={2}
			{key}
			showStepper={true}
			nextButton={{
				action: initializeWallet,
				disabled: !validMnemonic
			}}>
			<h2 class="h1" slot="heading">
				Backup<br/>
				<mark>Mnemonic Phrase</mark>
			</h2>
			<ValidateMnemonic bind:isValid={validMnemonic}/>
		</WizardStep>
		<!-- SETUP PASSWORD OPTIONAL -->
		<WizardStep
			step={3}
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
		<!--  SWAP DUSK -->
		<WizardStep
			step={4}
			{key}
			showStepper={true}
			backButton={{
				action: () => loginInfoStorage.remove(),
				disabled: false
			}}>
			<h2 class="h1" slot="heading">
				Swap ERC20<br/>
				to <mark>Native Dusk</mark>
			</h2>
			<SwapNDUSK/>
		</WizardStep>
		<!--  ALL DONE -->
		<WizardStep
			step={5}
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
