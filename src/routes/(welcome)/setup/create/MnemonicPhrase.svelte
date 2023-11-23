<script>
	import { Card, MnemonicGenerate, Stepper } from "$lib/dusk/components";
	import { mdiAlertOutline } from "@mdi/js";
	import onboardingWizardStore from "$lib/onboarding/onboardingWizardStore";
	import { mnemonicPhrase } from "$lib/onboarding/mnemonicPhrase";
	import { generateMnemonic } from "@jimber/simple-bip39";

	$: ({ totalSteps, currentStep } = $onboardingWizardStore);

	const mnemonic = generateMnemonic().split(" ");
	mnemonicPhrase.set(mnemonic);
	onboardingWizardStore.updateCanGoNext(true);
</script>

<h2>
	Backup<br/>
	<mark>Mnemonic Phrase</mark>
</h2>

<Stepper steps={totalSteps} activeStep={currentStep - 1}/>

<Card heading="Keep this SAFE" iconPath={mdiAlertOutline}>
	<div class="flex flex-col gap-1">
		<p>Please make sure to write your phrase down and save it in a secure location.</p>
		<MnemonicGenerate/>
	</div>
</Card>
