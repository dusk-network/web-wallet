<script>
	import { getContext } from "svelte";
	import Button from "../Button/Button.svelte";
	import Stepper from "../Stepper/Stepper.svelte";
	import { mdiArrowLeft, mdiArrowRight } from "@mdi/js";

	/** @type {Number} */
	export let step;
	export let key;

	/** @type {Boolean} */
	export let showStepper = false;

	/** @type {(() => void) | undefined} */
	export let onBack = undefined;

	/** @type {(() => void) | undefined} */
	export let onNext = undefined;

	export let backDisabled = false;
	export let nextDisabled = false;

	const wizardStore = getContext(key);

	$: ({ stepsCount, currentStep } = $wizardStore);

	function handleBack () {
		if (onBack) {
			onBack();
		}

		wizardStore.decrementStep();
	}

	function handleNext () {
		if (onNext) {
			onNext();
		}

		wizardStore.incrementStep();
	}
</script>

{#if step === currentStep}
	<slot name="heading"/>
	{#if showStepper}
		<Stepper steps={stepsCount} activeStep={currentStep}/>
	{/if}
	<slot></slot>
	<slot name="navigation">
		<div class="dusk-wizard__step_navigation">
			<Button
				disabled={currentStep === 0 || backDisabled}
				text="Back"
				variant="tertiary"
				icon={{ path: mdiArrowLeft }}
				on:click={handleBack}/>
			<Button
				disabled={currentStep + 1 === stepsCount || nextDisabled}
				text="Next"
				variant="tertiary"
				icon={{ path: mdiArrowRight, position: "after" }}
				on:click={handleNext}/>
		</div>
	</slot>
{/if}
