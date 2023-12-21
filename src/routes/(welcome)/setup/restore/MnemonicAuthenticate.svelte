<script>
	import { Card, Mnemonic } from "$lib/dusk/components";
	import { defaultWordsCount, enteredMnemonicPhrase } from "$lib/dusk/components/Mnemonic/store";
	import { onDestroy } from "svelte";

	export let isValid = false;

	/** @param {String[]} value */
	const checkStatus = (value) => {
		isValid = value.filter(word => word !== "").length === defaultWordsCount;
	};

	const unsubscribe = enteredMnemonicPhrase.subscribe(checkStatus);

	onDestroy(unsubscribe);
</script>

<Card heading="Enter your Mnemonic Phrase">
	<div class="flex flex-col gap-1">
		<Mnemonic type="authenticate"/>
	</div>
</Card>
