<svelte:options immutable={true}/>

<script>
	import { AnchorButton } from "$lib/dusk/components";
	import { mdiKeyOutline, mdiWalletOutline } from "@mdi/js";
</script>

<main class="flex flex-col gap-2">
	<h1>
		Unlocking the Future:<br/>
		Your <mark>DUSK</mark> native Wallet
	</h1>

	<div class="flex flex-col gap-1">
		<AnchorButton
			icon={{ path: mdiWalletOutline }}
			className="secondary"
			text="Create a new wallet"
			href="/setup/create"
		/>
		<AnchorButton
			icon={{ path: mdiKeyOutline }}
			className="tertiary"
			text="Restore wallet"
			href="/setup/restore"
		/>
	</div>
</main>
