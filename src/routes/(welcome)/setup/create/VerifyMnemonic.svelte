<script>
	import { Card, Stepper } from "$lib/dusk/components";
	import onboardingWizardStore from "$lib/onboarding/onboardingWizardStore";
	$: ({ totalSteps, currentStep } = $onboardingWizardStore);
</script>

<h2>
	Backup<br/>
	<mark>Mnemonic Phrase</mark>
</h2>

<Stepper steps={totalSteps} activeStep={currentStep - 1}/>

<Card heading="Verification">
	<div class="flex flex-col gap-1">
		<p>Ensure you have backed up the Mnemonic phrase.</p>
		<p>Placeholder</p>
	</div>
</Card>

