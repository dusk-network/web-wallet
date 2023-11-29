<script>
	import { Button, Textbox, Words } from "$lib/dusk/components";
	import { makeClassName } from "$lib/dusk/string";
	import {
		defaultWordsCount,
		enteredMnemonicPhrase,
		shuffledMnemonicPhrase
	} from "$lib/onboarding/mnemonicPhrase";
	import { findFirstNMatches } from "$lib/dusk/array";
	import enDictionary from "$lib/onboarding/enDictionary";

	let _enDictionary = enDictionary;

	/** @type {MnemonicType} */
	export let type;

	/** @type {String | Undefined} */
	export let className = undefined;
	const classes = makeClassName(["dusk-mnemonic", className]);

	enteredMnemonicPhrase.set(Array(defaultWordsCount).fill(""));

	/** @type {string[]} */
	const seed = type === "validate" ? $shuffledMnemonicPhrase : [];

	let currentIndex = 0;
	let currentInput = "";

	/**
	 * @param {string} word
	 */
	function updateEnteredPhrase (word) {
		$enteredMnemonicPhrase[currentIndex] = word;
		currentInput = "";
		currentIndex++;

		if (type === "authenticate") {
			_enDictionary = _enDictionary.filter(_word => !$enteredMnemonicPhrase.includes(_word));
			focusWordTextboxInput();
		}
	}

	/**
	 * Adds word to the entered phrase if only one prediction is available
	 * @param {{ key: string; }} event
	 */
	function handleKeyDownOnAuthenticateTextbox (event) {
		if (event.key === "Enter" && predictions.length === 1) {
			updateEnteredPhrase(predictions[0]);
		}
	}

	// @ts-ignore
	function handleWordButtonClick (event) {
		const word = event.currentTarget.dataset.value;

		updateEnteredPhrase(word);
	}

	$: predictions = currentInput && findFirstNMatches(_enDictionary, currentInput, 3);

	// eslint-disable-next-line svelte/no-reactive-functions
	$: mnemonicContains = (/** @type {string} */ word) => $enteredMnemonicPhrase.includes(word);

	$: if ($enteredMnemonicPhrase) {
		const emptyWord = new Set($enteredMnemonicPhrase).size === 1;

		if (emptyWord) {
			resetInput();
		}
	}

	function resetInput () {
		currentIndex = 0;
		currentInput = "";
		_enDictionary = enDictionary;
	}

	function focusWordTextboxInput () {
		if (textboxElement) {
			textboxElement.focusInput();
		}
	}

	/**
	 * @type {Textbox}
	 */
	let textboxElement;

</script>

<div {...$$restProps} class={classes}>
	<Words words={$enteredMnemonicPhrase}/>

	<div
		class={type === "authenticate"
			? "dusk-mnemonic__authenticate_actions_wrapper"
			: "dusk-mnemonic__validate_actions_wrapper"}>
		{#if type === "authenticate" && mnemonicContains("")}
			<Textbox
				bind:this={textboxElement}
				on:keydown={handleKeyDownOnAuthenticateTextbox}
				maxlength={8}
				type="text"
				bind:value={currentInput}/>
			{#if predictions.length}
				<div class="dusk-mnemonic__predictions_wrapper">
					{#each predictions as prediction, index (`${prediction}-${index}`)}
						<Button
							variant="tertiary"
							text={prediction}
							data-value={prediction}
							on:click={handleWordButtonClick}/>
					{/each}
				</div>
			{/if}
		{:else}
			{#each seed as word, index (`${word}-${index}`)}
				<Button
					variant="tertiary"
					text={word}
					data-value={word}
					disabled={mnemonicContains(word)}
					on:click={handleWordButtonClick}/>
			{/each}
		{/if}
	</div>
</div>
