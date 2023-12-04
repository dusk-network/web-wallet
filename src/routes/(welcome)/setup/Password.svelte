<script>
	import { Card, Stepper, Textbox } from "$lib/dusk/components";
	import { mdiKeyOutline } from "@mdi/js";
	import { onboardingWizardStore } from "$lib/stores";

	let password = "";
	let confirmPassword = "";

	$: ({ totalSteps, currentStep } = $onboardingWizardStore);
	$: isValid = (password.length > 0 && confirmPassword.length > 0) && (password === confirmPassword);
	$: onboardingWizardStore.updateCanGoNext(isValid);
</script>

<h2>
	<mark>Password</mark><br/>
	Setup
</h2>

<Stepper steps={totalSteps} activeStep={currentStep - 1}/>

<Card iconPath={mdiKeyOutline} heading="Password">
	<div class="flex flex-col gap-1">
		<p>Please store your password safely.</p>
		<Textbox type="password" bind:value={password} placeholder="Set Password"/>
		<Textbox type="password" bind:value={confirmPassword} placeholder="Confirm Password"/>
	</div>
</Card>
