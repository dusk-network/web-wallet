<script>
	import { getContext } from "svelte";
	import { AnchorButton, Button, Stepper } from "$lib/dusk/components";
	import { mdiArrowLeft, mdiArrowRight } from "@mdi/js";

	/** @type {Number} */
	export let step;
	export let key;

	/** @type {Boolean} */
	export let showStepper = false;
	export let showNavigation = true;

	/** @type {WizardButtonProps | Undefined} */
	export let backButton = undefined;

	/** @type {WizardButtonProps | Undefined} */
	export let nextButton = undefined;

	const wizardStore = getContext(key);

	$: ({ stepsCount, currentStep } = $wizardStore);

	function handleBack () {
		backButton?.action?.();
		wizardStore.decrementStep();
	}

	function handleNext () {
		nextButton?.action?.();
		wizardStore.incrementStep();
	}

	/**
	 * Returns the common props for the wizard buttons
	 * @param {WizardButtonProps | Undefined} wizardButtonProps
	 * @param {String} defaultLabel
	 * @param {String} defaultIconPath
	 */
	function getButtonProps (wizardButtonProps, defaultLabel, defaultIconPath, isNextButton = false) {
		const stepCondition = isNextButton ? currentStep + 1 === stepsCount : currentStep === 0;

		return {
			disabled: wizardButtonProps?.disabled ?? stepCondition,
			icon: wizardButtonProps?.icon
				?? { path: defaultIconPath, position: isNextButton ? "after" : "before", size: "normal" },
			text: wizardButtonProps?.label ?? defaultLabel,
			variant: wizardButtonProps?.variant ?? "tertiary"
		};
	}
</script>

{#if step === currentStep}
	<slot name="heading"/>
	{#if showStepper}
		<Stepper steps={stepsCount} activeStep={currentStep}/>
	{/if}
	<slot></slot>

	{#if showNavigation}
		<slot name="navigation">
			<div class="dusk-wizard__step-navigation">
				{#if backButton?.isAnchor}
					<AnchorButton
						{...getButtonProps(backButton, "Back", mdiArrowLeft)}
						href={backButton?.href ?? "#"}
					/>
				{:else}
					<Button
						{...getButtonProps(backButton, "Back", mdiArrowLeft)}
						on:click={handleBack}
					/>
				{/if}

				{#if nextButton?.isAnchor}
					<AnchorButton
						{...getButtonProps(nextButton, "Next", mdiArrowRight, true)}
						href={nextButton?.href ?? "#"}
					/>
				{:else}
					<Button
						{...getButtonProps(nextButton, "Next", mdiArrowRight, true)}
						on:click={handleNext}
					/>
				{/if}
			</div>
		</slot>
	{/if}
{/if}
