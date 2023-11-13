<script>

	import { Button, Stepper } from "$lib/dusk/components";
	import { DUSK_LOGO_PATH } from "$lib/dusk/icons/logo";
	import onboardingWizardStore from "$lib/onboarding/onboardingWizardStore";
	$: ({ totalSteps, currentStep } = $onboardingWizardStore);
</script>

<h2>
	Swap ERC20<br/>
	to <mark>Native Dusk</mark>
</h2>

<Stepper steps={totalSteps} activeStep={currentStep - 1}/>

<Button icon={{ path: DUSK_LOGO_PATH, position: "before" }} variant="secondary" text="Swap ERC20 to NDUSK"/>
