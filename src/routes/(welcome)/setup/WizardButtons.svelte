<script>
	import { goto } from "$app/navigation";
	import { Button } from "$lib/dusk/components";
	import { mdiArrowLeft, mdiArrowRight } from "@mdi/js";
	import { onboardingWizardStore } from "$lib/stores";
	import { defaultWordsCount, enteredMnemonicPhrase } from "$lib/dusk/components/Mnemonic/store";
	$: ({
		currentStep, totalSteps, shouldShowBack, canGoNext
	} = $onboardingWizardStore);

	/**
	 * @type {"create" | "restore"}
	 */
	export let flow;

	async function goBack () {
		if (currentStep === 1) {
			await goto("/setup");
			onboardingWizardStore.reset();
		} else {
			onboardingWizardStore.updateCurrentStep(currentStep - 1);
		}
	}

	async function goNext () {
		if (currentStep === totalSteps) {
			await goto("/dashboard");
			onboardingWizardStore.reset();
		} else {
			onboardingWizardStore.updateCurrentStep(currentStep + 1);
		}
	}

	function resetMnemonicPhrase () {
		enteredMnemonicPhrase.set(Array(defaultWordsCount).fill(""));
	}

	/**
	 * @param {{ key: string; }} event
	 */
	function onKeyDown (event) {
		if (event.key === "Enter" && canGoNext) {
			goNext();
		}
	}

	$: shouldDisplayReset = !canGoNext && ((flow === "create" && currentStep === 4)
		|| (flow === "restore" && currentStep === 1));
</script>

<svelte:window on:keydown={onKeyDown}/>

<div class="wizard_navigation_buttons">
	{#if shouldShowBack}
		<Button
			variant="tertiary"
			on:click={goBack}
			className="flex-1"
			icon={{ path: mdiArrowLeft }}
			text="Back"/>
	{/if}

	{#if shouldDisplayReset}
		<Button
			variant="secondary"
			on:click={resetMnemonicPhrase}
			className="flex-1"
			text="Reset"/>
	{:else}
		<Button
			disabled={!canGoNext}
			variant="tertiary"
			on:click={goNext}
			className="flex-1"
			icon={{ path: mdiArrowRight, position: "after" }}
			text="Next"/>
	{/if}

</div>

<style>
	.wizard_navigation_buttons {
		display: flex;
		flex-direction: row;
		gap: 1em;
	}
</style>
