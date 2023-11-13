<script>
	import { goto } from "$app/navigation";
	import { Button } from "$lib/dusk/components";
	import { mdiArrowLeft, mdiArrowRight } from "@mdi/js";
	import onboardingWizardStore from "$lib/onboarding/onboardingWizardStore";
	$: ({ currentStep, totalSteps, canGoNext } = $onboardingWizardStore);

	async function goBack () {
		if (currentStep === 1) {
			await goto("/setup");
			onboardingWizardStore.reset();
		} else {
			onboardingWizardStore.updateCurrentStep(currentStep - 1);
		}
	}

	async function goNext () {
		if (currentStep === totalSteps) {
			await goto("/dashboard");
			onboardingWizardStore.reset();
		} else {
			onboardingWizardStore.updateCurrentStep(currentStep + 1);
		}
	}
</script>

<div class="wizard_navigation_buttons">
	{#if totalSteps !== currentStep}
		<Button
			variant="tertiary"
			on:click={goBack}
			className="flex-1"
			icon={{ path: mdiArrowLeft }}
			text="Back"/>
	{/if}
	<Button
		disabled={!canGoNext}
		variant="tertiary"
		on:click={goNext}
		className="flex-1"
		icon={{ path: mdiArrowRight, position: "after" }}
		text="Next"/>
</div>

<style>
	.wizard_navigation_buttons {
		display: flex;
		flex-direction: row;
		gap: 1em;
	}
</style>
