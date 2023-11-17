<script>
	import { onMount } from "svelte";
	import { Card, Stepper } from "$lib/dusk/components";
	import onboardingWizardStore from "$lib/onboarding/onboardingWizardStore";

	$: ({ totalSteps, currentStep } = $onboardingWizardStore);

	onMount(() => {
		// temp
		onboardingWizardStore.updateCanGoNext(true);
	});
</script>

<h2>
	Enter<br/>
	<mark>Mnemonic Phrase</mark>
</h2>

<Stepper steps={totalSteps} activeStep={currentStep - 1}/>

<Card heading="Enter your Mnemonic Phrase">
	<div class="flex flex-col gap-1">
		<p>Placeholder</p>
	</div>
</Card>
