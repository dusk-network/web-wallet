<svelte:options immutable={true}/>

<script>
	import { fade } from "svelte/transition";
	import { encryptMnemonic } from "$lib/wallet";
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
	import Password from "../Password.svelte";
	import { goto } from "$app/navigation";

	let tosAccepted = false;

	// Password
	let password = "";
	let validPassword = false;

	// Notice
	let agreementAccepted = false;

	// Mnemonic
	let validMnemonic = false;

	async function storePasswordToLocalStorage () {
		const mnemonic = $mnemonicPhrase.join(" ");
		const encryptedData = await encryptMnemonic(mnemonic, password);

		loginInfoStorage.set(encryptedData);
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
			nextButton={{ disabled: !validMnemonic }}>
			<h2 class="h1" slot="heading">
				Backup<br/>
				<mark>Mnemonic Phrase</mark>
			</h2>
			<ValidateMnemonic bind:isValid={validMnemonic}/>
		</WizardStep>
		<!--  PASSWORD -->
		<WizardStep
			step={3}
			{key}
			showStepper={true}
			nextButton={{
				action: async () => {
					await storePasswordToLocalStorage();
				},
				disabled: !validPassword
			}}
		>
			<h2 class="h1" slot="heading">
				<mark>Password</mark><br/>
				Setup
			</h2>
			<Password bind:password bind:isValid={validPassword}/>
		</WizardStep>
		<!--  SWAP DUSK -->
		<WizardStep
			step={4}
			{key}
			showStepper={true}>
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
				}
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
