<svelte:options immutable={true}/>

<script>
	import { fade } from "svelte/transition";
	import { onboardingWizardStore } from "$lib/stores";
	import WizardButtons from "../WizardButtons.svelte";
	import TermsOfService from "../TermsOfService.svelte";

	// Steps
	import Password from "../Password.svelte";
	import AllSet from "../AllSet.svelte";
	import MnemonicAuthenticate from "./MnemonicAuthenticate.svelte";

	$: ({ currentStep } = $onboardingWizardStore);

	const steps = [MnemonicAuthenticate,
		Password,
		AllSet];
</script>

{#if currentStep === 0}
	<div class="onboarding-wrapper" in:fade|global>
		<TermsOfService/>
	</div>
{:else}
	<div class="onboarding-wrapper flex flex-col gap-2" in:fade|global>
		<svelte:component this={steps[currentStep - 1]}/>
	</div>
	<WizardButtons flow="restore"/>
{/if}

<style>
	.onboarding-wrapper {
		height: 100%;
		overflow-y: auto;
	}
</style>
