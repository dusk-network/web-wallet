<script>
	import { Card, Stepper } from "$lib/dusk/components";
	import { mdiExclamationThick } from "@mdi/js";
	import onboardingWizardStore from "$lib/onboarding/onboardingWizardStore";

	$: ({ totalSteps, currentStep } = $onboardingWizardStore);
</script>

<h2>
	Backup<br/>
	<mark>Mnemonic Phrase</mark>
</h2>

<Stepper steps={totalSteps} activeStep={currentStep - 1}/>

<Card heading="Keep this SAFE" iconPath={mdiExclamationThick}>
	<div class="flex flex-col gap-1">
		<p>Please make sure to write your phrase down and save it in a secure location.</p>
		<p>Placeholder</p>
	</div>
</Card>
