<script>
	import { mdiArrowLeftCircleOutline } from "@mdi/js";
	import { Button } from "$lib/dusk/components";
	import { operationsStore } from "$lib/contracts";

	/** @type string */
	export let heading;

</script>

<header class="operation-header">
	<Button
		icon={{ path: mdiArrowLeftCircleOutline }}
		on:click={() => operationsStore.update(store => ({ ...store, currentOperation: undefined }))}
		variant="text"
	/>
	<h3 class="h4">
		{heading}
	</h3>
</header>
