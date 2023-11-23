<script>
	import { makeClassName } from "$lib/dusk/string";
	import { mnemonicPhrase } from "$lib/onboarding/mnemonicPhrase";

	/** @type {String | Undefined} */
	export let className = undefined;

	/**
	 * @type {string[]}
	 */
	const words = $mnemonicPhrase;

	$: classes = makeClassName(["dusk-mnemonic", "dusk-mnemonic--generate", className]);
</script>

<div class={classes}>
	<div class="dusk-mnemonic-words">
		{#each words as word, index (`${word}-${index}`)}
			<div class="flex flex-row">
				<div class="dusk-mnemonic-word__index">{index + 1}</div>
				<div class="dusk-mnemonic-word__text">{word}</div>
			</div>
		{/each}
	</div>
</div>
