<script>
	import { wordlists } from "bip39";

	import { Button, Textbox, Words } from "$lib/dusk/components";
	import { makeClassName } from "$lib/dusk/string";
	import {
		defaultWordsCount,
		enteredMnemonicPhrase,
		shuffledMnemonicPhrase
	} from "./store";
	import { findFirstNMatches } from "$lib/dusk/array";

	let enDictionary = wordlists.english;

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
	const enteredWordIndex = Array(defaultWordsCount).fill("");

	/**
	 * @param {string} word
	 * @param {string} index
	 */
	function updateEnteredPhrase (word, index) {
		$enteredMnemonicPhrase[currentIndex] = word;
		enteredWordIndex[currentIndex] = index;

		currentInput = "";
		currentIndex++;

		if (type === "authenticate") {
			focusWordTextboxInput();
		}
	}

	/**
	 * Adds word to the entered phrase if only one prediction is available
	 * @param {{ key: string }} event
	 * @param {string} index
	 */
	function handleKeyDownOnAuthenticateTextbox (event, index) {
		if (event.key === "Enter" && predictions.length === 1) {
			updateEnteredPhrase(predictions[0], index);
		}
	}

	// @ts-ignore
	function handleWordButtonClick (event, index) {
		const word = event.currentTarget.dataset.value;

		updateEnteredPhrase(word, index);
	}

	$: predictions = currentInput && findFirstNMatches(enDictionary, currentInput, 3);

	// eslint-disable-next-line svelte/no-reactive-functions
	$: mnemonicContains = (/** @type {string} */ index) => enteredWordIndex.includes(index);

	$: if ($enteredMnemonicPhrase) {
		const emptyWord = new Set($enteredMnemonicPhrase).size === 1;

		if (emptyWord) {
			resetInput();
		}
	}

	function resetInput () {
		currentIndex = 0;
		currentInput = "";
		enDictionary = enDictionary;
	}

	function focusWordTextboxInput () {
		textboxElement?.focus();
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
			? "dusk-mnemonic__authenticate-actions-wrapper"
			: "dusk-mnemonic__validate-actions-wrapper"}>
		{#if type === "authenticate" && mnemonicContains("")}
			<Textbox
				placeholder={`Enter word ${currentIndex + 1}`}
				bind:this={textboxElement}
				on:keydown={(e) => handleKeyDownOnAuthenticateTextbox(e, currentIndex.toString())}
				maxlength={8}
				type="text"
				bind:value={currentInput}/>
			{#if predictions.length}
				<div class="dusk-mnemonic__predictions-wrapper">
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
					disabled={mnemonicContains(index.toString())}
					on:click={(e) => handleWordButtonClick(e, index.toString())}/>
			{/each}
		{/if}
	</div>
</div>
