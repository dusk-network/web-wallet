<script>
	import { Card, Stepper } from "$lib/dusk/components";
	import onboardingWizardStore from "$lib/onboarding/onboardingWizardStore";
	const allSetIllustration = "/images/onboarding/all_set_illustration.svg";

	$: ({ totalSteps, currentStep } = $onboardingWizardStore);
</script>

<h2>
	Welcome to<br/>
	<mark>Dusk</mark>
</h2>

<Stepper steps={totalSteps} activeStep={currentStep - 1}/>

<Card heading="You are all set!">
	<img
		src={allSetIllustration}
		width="205"
		height="182"
		id="all_set_illustration"
		alt="All Set"/>
</Card>

<style>
	#all_set_illustration {
		display: block;
		width: 50%;
		margin: 1em auto;
	}
</style>
