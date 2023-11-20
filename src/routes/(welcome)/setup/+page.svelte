<svelte:options immutable={true}/>

<script>
	import { AnchorButton } from "$lib/dusk/components";
	import { mdiKeyOutline, mdiWalletOutline } from "@mdi/js";
</script>

<section class="flex flex-col gap-2">
	<header>
		<h2>
			Unlocking the Future:<br/>
			Your <mark>DUSK</mark> native Wallet
		</h2>
	</header>

	<div class="flex flex-col gap-1">
		<AnchorButton
			icon={{ path: mdiWalletOutline }}
			href="/setup/create"
			text="Create a new wallet"
			variant="secondary"
		/>
		<AnchorButton
			href="/setup/restore"
			icon={{ path: mdiKeyOutline }}
			text="Restore wallet"
			variant="tertiary"
		/>
	</div>
</section>
