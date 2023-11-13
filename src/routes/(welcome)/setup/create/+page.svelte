<svelte:options immutable={true}/>

<script>
	import { fade } from "svelte/transition";
	import onboardingWizardStore from "$lib/onboarding/onboardingWizardStore";
	import WizardButtons from "../WizardButtons.svelte";
	import TermsOfService from "../TermsOfService.svelte";

	$: ({ currentStep } = $onboardingWizardStore);

	// Steps
	import Password from "../Password.svelte";
	import MnemonicPreSetup from "./MnemonicPreSetup.svelte";
	import MnemonicPhrase from "./MnemonicPhrase.svelte";
	import VerifyMnemonic from "./VerifyMnemonic.svelte";
	import SwapNDUSK from "./SwapNDUSK.svelte";
	import AllSet from "../AllSet.svelte";

	const steps = [Password,
		MnemonicPreSetup,
		MnemonicPhrase,
		VerifyMnemonic,
		SwapNDUSK,
		AllSet];
</script>

{#if currentStep === 0}
	<div class="onboarding_wrapper" in:fade|global>
		<TermsOfService/>
	</div>
{:else}
	<div class="onboarding_wrapper flex flex-col gap-2" in:fade|global>
		<svelte:component this={steps[currentStep - 1]}/>
	</div>
	<WizardButtons/>
{/if}

<style>
	.onboarding_wrapper {
		height: 100%;
	}
</style>
