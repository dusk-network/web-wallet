<script>
	import { Card, Mnemonic } from "$lib/dusk/components";
	import { defaultWordsCount, enteredMnemonicPhrase } from "$lib/dusk/components/Mnemonic/store";
	import { onDestroy } from "svelte";

	export let isValid = false;

	/**
	 * @param {String[]} value
	 */
	function checkStatus (value) {
		const filteredWords = value.filter(word => word !== "");
		const set = new Set(filteredWords);

		if (set.size === defaultWordsCount) {
			isValid = true;
		}
	}

	const unsubscribe = enteredMnemonicPhrase.subscribe(checkStatus);

	onDestroy(() => {
		unsubscribe();
	});
</script>

<Card heading="Enter your Mnemonic Phrase">
	<div class="flex flex-col gap-1">
		<Mnemonic type="authenticate"/>
	</div>
</Card>
