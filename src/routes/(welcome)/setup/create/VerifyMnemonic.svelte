<script>
	import { Card, MnemonicValidate, Stepper } from "$lib/dusk/components";
	import onboardingWizardStore from "$lib/onboarding/onboardingWizardStore";
	import { mnemonicPhrase } from "$lib/onboarding/mnemonicPhrase";
	import { arraysEqual } from "$lib/dusk/array";
	import { onDestroy } from "svelte";
	$: ({ totalSteps, currentStep } = $onboardingWizardStore);

	/**
	 * @type {string[]}
	 */
	let words = [];

	/**
	 * @param {{ detail: string[]; }} event
	 */
	function updateMnemonic (event) {
		words = event.detail;
	}

	$: isValid = arraysEqual(words, $mnemonicPhrase);
	$: onboardingWizardStore.updateCanGoNext(isValid);

	onDestroy(() => {
		mnemonicPhrase.set([]);
	});
</script>

<h2>
	Backup<br/>
	<mark>Mnemonic Phrase</mark>
</h2>

<Stepper steps={totalSteps} activeStep={currentStep - 1}/>

<Card heading="Verification">
	<div class="flex flex-col gap-1">
		<p>Ensure you have backed up the Mnemonic phrase.</p>
		<MnemonicValidate on:update={updateMnemonic}/>
	</div>
</Card>

