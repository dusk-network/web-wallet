<svelte:options immutable={true}/>

<script>
	import { fade } from "svelte/transition";

	import { Select } from "$lib/dusk/components";

	import AnchorButtons from "./AnchorButtons.svelte";
	import Cards from "./Cards.svelte";
	import IconButtons from "./IconButtons.svelte";
	import LabeledButtons from "./LabeledButtons.svelte";
	import ProgressBars from "./ProgressBars.svelte";
	import Selects from "./Selects.svelte";
	import Steppers from "./Steppers.svelte";
	import Tabboxes from "./Tabboxes.svelte";
	import Textboxes from "./Textboxes.svelte";
	import Throbbers from "./Throbbers.svelte";
	import Tooltips from "./Tooltips.svelte";

	/** @type {Record<string, import("svelte").ComponentType>} */
	const componentsMap = {
		"Anchor buttons": AnchorButtons,
		"Cards": Cards,
		"Icon buttons": IconButtons,
		"Labeled buttons": LabeledButtons,
		"Progress bars": ProgressBars,
		"Selects": Selects,
		"Steppers": Steppers,
		"Tabboxes": Tabboxes,
		"Textboxes": Textboxes,
		"Throbbers": Throbbers,
		"Tooltips": Tooltips
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

			& > :global(section) {
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
