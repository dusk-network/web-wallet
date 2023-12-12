<script>
	import { Card, Words } from "$lib/dusk/components";
	import { mdiAlertOutline } from "@mdi/js";
	import { mnemonicPhrase } from "$lib/dusk/components/Mnemonic/store";
	import { generateMnemonic } from "bip39";

	if ($mnemonicPhrase.length === 0) {
		const mnemonic = generateMnemonic().split(" ");

		mnemonicPhrase.set(mnemonic);
	}
</script>

<Card heading="Keep this SAFE" iconPath={mdiAlertOutline}>
	<div class="flex flex-col gap-1">
		<p>Please make sure to write your phrase down and save it in a secure location.</p>
		<Words words={$mnemonicPhrase}/>
	</div>
</Card>
