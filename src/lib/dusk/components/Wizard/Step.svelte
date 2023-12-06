<script>
	import { getContext } from "svelte";
	import Button from "../Button/Button.svelte";

	/** * @type {number}  */
	export let step;

	/** @type {{ label: any; variant: any; action: () => void } | undefined} */
	export let backButton = undefined;

	/** @type {{ label: any; variant: any; action: () => void } | undefined} */
	export let nextButton = undefined;

	const { currentStepIndex, next, back } = getContext("wizard");

	function handleBackClick () {
		if (backButton?.action) {
			backButton.action();
		}

		back();
	}

	function handleNextClick () {
		if (nextButton?.action) {
			nextButton.action();
		}

		next();
	}

</script>

{#if $currentStepIndex === step}
	<div class="duk-wizard__step">
		<slot></slot>

		<div class="dusk-wizard__navigation">
			{#if backButton}
				<Button
					text={backButton.label}
					variant={backButton.variant}
					on:click={handleBackClick}/>
			{/if}

			{#if nextButton}
				<Button
					text={nextButton.label}
					variant={nextButton.variant}
					on:click={handleNextClick}/>
			{/if}
		</div>
	</div>
{/if}

<style lang="postcss">
  .dusk-wizard__navigation {
    display: flex;
    flex-direction: row;
    gap: var(--default-gap);
    .dusk-wizard__navigation button {
      flex: 1;
    }
}
</style>
