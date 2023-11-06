<svelte:options immutable={true}/>

<script>
	import {
		Anchor, AnchorButton, Button, Card, Textbox
	} from "$lib/dusk/components";
	import { mdiKeyOutline } from "@mdi/js";
</script>

<main class="flex flex-col gap-2">
	<h1>
		Unleash <span class="accent-text">RWA</span> and<br/>
		<span class="accent-text">Decentralized Finance</span>
	</h1>

	<Card className="flex flex-col gap-1" iconPath={mdiKeyOutline} heading="Password">
		<Textbox type="password" required placeholder="Password"/>
		<Button variant="secondary" text="Unlock Wallet"/>
		<AnchorButton variant="text" href="#" text="Forgot Password?"/>
	</Card>
</main>

<footer>
	<p>Need help? Contact <Anchor href="#">DUSK support</Anchor></p>
</footer>

<style>
	footer {
		margin-top: auto;
	}
</style>
