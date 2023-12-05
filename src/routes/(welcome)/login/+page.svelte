<svelte:options immutable={true}/>

<script>
	import {
		Anchor, AnchorButton, Button, Card, Textbox
	} from "$lib/dusk/components";
	import { mdiKeyOutline } from "@mdi/js";

	import loginInfoStorage from "$lib/services/loginInfoStorage";

	const loginInfo = loginInfoStorage.get();
	const modeLabel = loginInfo ? "Password" : "Mnemonic phrase";
</script>

<section class="flex flex-col gap-2">
	<h1>
		Unleash <mark>RWA</mark> and<br/>
		<mark>Decentralized Finance</mark>
	</h1>

	<Card className="flex flex-col gap-1" iconPath={mdiKeyOutline} heading={modeLabel}>
		<Textbox type="password" required placeholder={modeLabel}/>
		<Button variant="secondary" text="Unlock Wallet"/>
		{#if modeLabel === "Password"}
			<AnchorButton variant="text" href="/setup/restore" text="Forgot Password?"/>
		{/if}
	</Card>
</section>

<footer>
	<p>Need help? Contact <Anchor href="#">DUSK support</Anchor></p>
</footer>

<style>
	footer {
		margin-top: auto;
	}
</style>
