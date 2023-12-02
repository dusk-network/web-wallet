<script>

	import { Button, Stepper } from "$lib/dusk/components";
	import { logo } from "$lib/dusk/icons";
	import { mnemonicPhrase } from "$lib/dusk/components/Mnemonic/store";
	import { onboardingWizardStore } from "$lib/stores";
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
