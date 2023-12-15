<svelte:options immutable={true}/>

<script>
	import { fade } from "svelte/transition";
	import TermsOfService from "../TermsOfService.svelte";

	// Steps
	import Password from "../Password.svelte";
	import AllSet from "../AllSet.svelte";
	import MnemonicAuthenticate from "./MnemonicAuthenticate.svelte";
	import { Wizard, WizardStep } from "$lib/dusk/components";
	import { mnemonicPhrase } from "$lib/dusk/components/Mnemonic/store";
	import { encryptMnemonic } from "$lib/wallet";
	import loginInfoStorage from "$lib/services/loginInfoStorage";
	import { goto } from "$app/navigation";

	let tosAccepted = false;

	// Password
	let password = "";
	let validPassword = false;

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
			nextButton={{ disabled: !validMnemonic }}>
			<h1 slot="heading">
				Enter<br/>
				<mark>Mnemonic Phrase</mark>
			</h1>
			<MnemonicAuthenticate bind:isValid={validMnemonic}/>
		</WizardStep>
		<WizardStep
			step={1}
			{key}
			showStepper={true}
			nextButton={{
				action: async () => {
					await storePasswordToLocalStorage();
				},
				disabled: !validPassword
			}}
		>
			<h1 slot="heading">
				<mark>Password</mark><br/>
				Setup
			</h1>
			<Password bind:password bind:isValid={validPassword}/>
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
				}
			}}>
			<h1 slot="heading">
				Welcome to<br/>
				<mark>Dusk</mark>
			</h1>
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
