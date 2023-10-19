<svelte:options immutable={true}/>

<script>
	import { fade } from "svelte/transition";

	import { Select } from "$lib/dusk/components";

	import AnchorButtons from "./AnchorButtons.svelte";
	import IconButtons from "./IconButtons.svelte";
	import LabeledButtons from "./LabeledButtons.svelte";
	import Selects from "./Selects.svelte";
	import Textboxes from "./Textboxes.svelte";
	import Throbbers from "./Throbbers.svelte";

	/** @type {Record<string, import("svelte").ComponentType>} */
	const componentsMap = {
		"Anchor buttons": AnchorButtons,
		"Icon buttons": IconButtons,
		"Labeled buttons": LabeledButtons,
		"Selects": Selects,
		"Textboxes": Textboxes,
		"Throbbers": Throbbers
	};

	const componentsOptions = Object.keys(componentsMap);

	let selectedSection = componentsOptions[0];
</script>

<main>
	<header>
		<h1>COMPONENTS SHOWCASE</h1>
		<Select options={componentsOptions} bind:value={selectedSection}/>
	</header>

	{#key selectedSection}
		<div in:fade>
			<svelte:component this={componentsMap[selectedSection]}/>
		</div>
	{/key}
</main>

<style lang="postcss">
	main {
		overflow: hidden;
		display: flex;
		flex-direction: column;

		& > header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 1em;
			padding: .5em;
		}

		& > div {
			flex: 1;
			margin-top: 2em;
			overflow-y: auto;

			& > :global(*) {
				display: flex;
				align-items: center;
				justify-content: space-around;
				flex-wrap: wrap;
				gap: 1em;
				margin: 1.5em 0;
			}
		}
	}
</style>
