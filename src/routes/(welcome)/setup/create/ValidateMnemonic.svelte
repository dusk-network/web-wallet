<script>
	import {
		Card, Icon, Mnemonic, Stepper
	} from "$lib/dusk/components";
	import { onboardingWizardStore } from "$lib/stores";
	import { enteredMnemonicPhrase, mnemonicPhrase } from "$lib/dusk/components/Mnemonic/store";
	import { arraysEqual } from "$lib/dusk/array";
	import { mdiAlertOutline } from "@mdi/js";

	$: ({ totalSteps, currentStep } = $onboardingWizardStore);

	$: isValid = arraysEqual($enteredMnemonicPhrase, $mnemonicPhrase);
	$: onboardingWizardStore.updateCanGoNext(isValid);
</script>

<h2>
	Backup<br/>
	<mark>Mnemonic Phrase</mark>
</h2>

<Stepper steps={totalSteps} activeStep={currentStep - 1}/>

<Card heading="Verification">
	<div class="flex flex-col gap-1">
		<p>Ensure you have backed up the Mnemonic phrase.</p>
		<Mnemonic type="validate"/>
		{#if !isValid}
			<div class="notice notice--error">
				<Icon path={mdiAlertOutline} size="large"/>
				<p>Mnemonic Phrase does not match.</p>
			</div>
		{/if}
	</div>
</Card>

