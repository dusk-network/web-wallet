<script>
	import { Agreement, Card, Stepper } from "$lib/dusk/components";
	import Icon from "$lib/dusk/components/Icon/Icon.svelte";
	import onboardingWizardStore from "$lib/onboarding/onboardingWizardStore";
	import { mdiAlertOutline } from "@mdi/js";
	let agreementOneChecked = false;
	let agreementTwoChecked = false;

	const agreementOneLabel =
		"I understand that without my seed phrase I cannot access my wallet and its assets.";
	const agreementTwoLabel =
		`I understand that securing my recovery phrase is my own responsibility.
		Only I have access to my recovery phrase`;

	$: ({ totalSteps, currentStep } = $onboardingWizardStore);
	$: isValid = agreementOneChecked && agreementTwoChecked;
	$: onboardingWizardStore.updateCanGoNext(isValid);
</script>

<h2>
	Backup<br/>
	<mark>Mnemonic Phrase</mark>
</h2>

<Stepper steps={totalSteps} activeStep={currentStep - 1}/>

<Card heading="Securely store your seed phrase!">
	<div class="flex flex-col gap-1">
		<Agreement
			name="mnemonic_agreement_one"
			bind:checked={agreementOneChecked}
			label={agreementOneLabel}/>
		<Agreement
			name="mnemonic_agreement_two"
			bind:checked={agreementTwoChecked}
			label={agreementTwoLabel}/>
	</div>
</Card>

<div class="notice">
	<Icon path={mdiAlertOutline} size="large"/>
	<p>To proceed, please check all the relevant boxes.
		Dusk will not save and cannot retrieve your passphrase.</p>
</div>
