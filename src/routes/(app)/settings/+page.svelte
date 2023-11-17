<svelte:options immutable={true}/>

<script>
	import { mdiArrowLeftCircleOutline } from "@mdi/js";
	import { AnchorButton } from "$lib/dusk/components";
</script>

<section class="flex flex-col gap-2">
	<header class="header">
		<AnchorButton href="/dashboard" icon={{ path: mdiArrowLeftCircleOutline }} variant="text"/>
		<h2>
			Settings
		</h2>
	</header>
</section>

<style lang="postcss">
	.header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
</style>
