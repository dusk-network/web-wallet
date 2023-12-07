<script>
	import { setContext } from "svelte";
	import createWizardStore from "./createWizardStore";

	export let steps = 0;

	const storeKey = `DUSK:WIZARD:${Math.random().toString(36)}`;

	const wizardStore = createWizardStore(steps);
	setContext(storeKey, wizardStore);
</script>

<div class="dusk-wizard">
	<slot key={storeKey}></slot>
</div>
