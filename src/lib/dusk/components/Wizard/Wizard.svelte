<script>
	import { setContext } from "svelte";
	import createWizard from "./wizardContext.js";
	import Stepper from "../Stepper/Stepper.svelte";

	/**  @type {number} */
	export let stepsCount;

	const {
		currentStepIndex, isLastStep, isFirstStep, back, next
	} = createWizard(stepsCount);

	setContext("wizard", {
		currentStepIndex, isLastStep, isFirstStep, back, next
	});
</script>

<div>
	<Stepper steps={stepsCount} activeStep={$currentStepIndex}/>
	<slot></slot>
</div>
