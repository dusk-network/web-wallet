<script>
	import {
		Card, Icon, Mnemonic
	} from "$lib/dusk/components";
	import { enteredMnemonicPhrase, mnemonicPhrase } from "$lib/dusk/components/Mnemonic/store";
	import { arraysEqual } from "$lib/dusk/array";
	import { mdiAlertOutline } from "@mdi/js";

	export let isValid = false;

	$: filteredMnemonic = new Set($enteredMnemonicPhrase.filter((word) => word !== ""));
	$: isValid = arraysEqual($enteredMnemonicPhrase, $mnemonicPhrase);
</script>

<Card heading="Verification">
	<div class="flex flex-col gap-1">
		<p>Ensure you have backed up the Mnemonic phrase.</p>
		<Mnemonic type="validate"/>
		{#if filteredMnemonic.size === 12 && !isValid}
			<div class="notice notice--error">
				<Icon path={mdiAlertOutline} size="large"/>
				<p>Mnemonic Phrase does not match.</p>
			</div>
		{/if}
	</div>
</Card>

