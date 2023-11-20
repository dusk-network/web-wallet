<script>
	import { createEventDispatcher } from "svelte";
	import Button from "../Button/Button.svelte";
	import { shuffledMnemonicPhrase } from "$lib/onboarding/mnemonicPhrase";
	import { makeClassName } from "$lib/dusk/string";
	const dispatch = createEventDispatcher();

	/** @type {String | Undefined} */
	export let className = undefined;

	/**
	 * @type {string[]}
	 */
	let words = [];

	let currentIndex = 0;

	/**
	 * @type {string[]}
	 */
	let seed = $shuffledMnemonicPhrase;

	// @ts-ignore
	function handleClick (event) {
		const value = event.currentTarget.dataset.value;

		if (!value) {
			return;
		}

		seed = seed.filter(word => word !== value);
		words[currentIndex] = value;
		currentIndex++;
		dispatch("update", words);
	}

	words = Array(seed.length).fill("");

	$: classes = makeClassName(["dusk-mnemonic", "dusk-mnemonic--validate", className]);
</script>

<div class={classes}>
	<div class="dusk-mnemonic-words">
		{#each words as word, index (`${word}-${index}`)}
			<div class="flex flex-row">
				<div class="dusk-mnemonic-word__index">{index + 1}</div>
				<div class="dusk-mnemonic-word__text">
					{word === "" ? "_____" : word}
				</div>
			</div>
		{/each}
	</div>

	<div class="dusk-mnemonic-validate-buttons-wrapper">
		{#each seed as word, index (index)}
			<Button
				variant="tertiary"
				on:click={handleClick}
				data-value={word}
				text={word}/>
		{/each}
	</div>
</div>
