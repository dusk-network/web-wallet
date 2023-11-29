<script>

	import { Button, Stepper } from "$lib/dusk/components";
	import { logo } from "$lib/dusk/icons";
	import { mnemonicPhrase } from "$lib/onboarding/mnemonicPhrase";
	import onboardingWizardStore from "$lib/onboarding/onboardingWizardStore";
	$: ({ totalSteps, currentStep } = $onboardingWizardStore);

	mnemonicPhrase.set([]);

	onboardingWizardStore.updateShouldShowBack(false);
</script>

<h2>
	Swap ERC20<br/>
	to <mark>Native Dusk</mark>
</h2>

<Stepper steps={totalSteps} activeStep={currentStep - 1}/>

<Button icon={{ path: logo, position: "before" }} variant="secondary" text="Swap ERC20 to NDUSK"/>
