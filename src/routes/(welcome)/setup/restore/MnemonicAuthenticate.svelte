<script>
	import { Card, MnemonicAuthenticate, Stepper } from "$lib/dusk/components";
	import onboardingWizardStore from "$lib/onboarding/onboardingWizardStore";

	$: ({ totalSteps, currentStep } = $onboardingWizardStore);

	onboardingWizardStore.updateCanGoNext(false);
	const wordsCount = 12;

	/**
	 * @param {{ detail: string[]; }} event
	 */
	function updateWords (event) {
		const filteredWords = event.detail.filter(word => word !== "");
		const set = new Set(filteredWords);

		if (set.size === wordsCount) {
			onboardingWizardStore.updateCanGoNext(true);
		}
	}
</script>

<h2>
	Enter<br/>
	<mark>Mnemonic Phrase</mark>
</h2>

<Stepper steps={totalSteps} activeStep={currentStep - 1}/>

<Card heading="Enter your Mnemonic Phrase">
	<div class="flex flex-col gap-1">
		<MnemonicAuthenticate {wordsCount} on:update={updateWords}/>
	</div>
</Card>
