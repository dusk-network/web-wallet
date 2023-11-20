<script>
	import { createEventDispatcher } from "svelte";
	import Button from "../Button/Button.svelte";
	import Textbox from "../Textbox/Textbox.svelte";
	import { makeClassName } from "$lib/dusk/string";

	/** @type {String | Undefined} */
	export let className = undefined;

	export let wordsCount = 12;

	const dispatch = createEventDispatcher();

	let currentIndex = 0;
	let enteredWord = "";
	const words = Array(wordsCount).fill("");

	function handleEnter () {
		if (!enteredWord) {
			return;
		}

		if (currentIndex >= wordsCount) {
			return;
		}

		words[currentIndex] = enteredWord;
		enteredWord = "";
		currentIndex++;
		dispatch("update", words);
	}

	// @ts-ignore
	function handleKeyDown (event) {
		if (event.key === "Enter") {
			event.preventDefault();
			handleEnter();
		}
	}

	$: classes = makeClassName(["dusk-mnemonic", "dusk-mnemonic--authenticate", className]);
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

	<div class="dusk-mnemonic-authenticate-inputs-wrapper">
		<Textbox on:keydown={handleKeyDown} type="text" bind:value={enteredWord}/>
		<Button variant="tertiary" text="Enter" on:click={handleEnter}/>
	</div>
</div>
