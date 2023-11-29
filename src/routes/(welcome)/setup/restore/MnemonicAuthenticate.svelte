<script>
	import { Card, Mnemonic, Stepper } from "$lib/dusk/components";
	import { defaultWordsCount, enteredMnemonicPhrase } from "$lib/onboarding/mnemonicPhrase";
	import onboardingWizardStore from "$lib/onboarding/onboardingWizardStore";
	import { onDestroy, onMount } from "svelte";

	$: ({ totalSteps, currentStep } = $onboardingWizardStore);

	/**
	 * @param {String[]} value
	 */
	function checkStatus (value) {
		const filteredWords = value.filter(word => word !== "");
		const set = new Set(filteredWords);

		if (set.size === defaultWordsCount) {
			onboardingWizardStore.updateCanGoNext(true);
		}
	}

	const unsubscribe = enteredMnemonicPhrase.subscribe(checkStatus);

	onDestroy(() => {
		unsubscribe();
	});

	onMount(() => {
		onboardingWizardStore.updateCanGoNext(false);
	});
</script>

<h2>
	Enter<br/>
	<mark>Mnemonic Phrase</mark>
</h2>

<Stepper steps={totalSteps} activeStep={currentStep - 1}/>

<Card heading="Enter your Mnemonic Phrase">
	<div class="flex flex-col gap-1">
		<Mnemonic type="authenticate"/>
	</div>
</Card>
