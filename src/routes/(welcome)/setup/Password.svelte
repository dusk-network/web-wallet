<script>
	import {
		Card, Icon, Textbox
	} from "$lib/dusk/components";
	import { mdiAlertOutline, mdiKeyOutline } from "@mdi/js";

	export let password = "";
	let confirmPassword = "";

	export let isValid = false;
	let isToggled = false;

	$: isValid = !isToggled
		|| ((password.length >= 8 && confirmPassword.length >= 8) && (password === confirmPassword));

	$: if (isToggled) {
		password = "";
		confirmPassword = "";
	}
</script>

<Card
	hasToggle
	bind:isToggled
	iconPath={mdiKeyOutline}
	heading="Password">
	<div class="flex flex-col gap-1">
		<p>Please store your password safely.</p>
		<Textbox type="password" bind:value={password} placeholder="Set Password"/>
		<div class="confirm-password">
			<Textbox type="password" bind:value={confirmPassword} placeholder="Confirm Password"/>
			{#if password.length < 8}
				<span class="confirm-password--meta">Password must be at least 8 characters</span>
			{:else if confirmPassword && password !== confirmPassword}
				<span
					class="confirm-password--meta
						confirm-password--meta--error">Passwords do not match</span>
			{/if}
		</div>
	</div>
</Card>

<div class="notice">
	<Icon path={mdiAlertOutline} size="large"/>
	<p>Setting a password for your web wallet is optional, but doing so will weaken its security.</p>
</div>

<style lang="postcss">
	.confirm-password {
		display: flex;
		flex-direction: column;

		&--meta {
			font-size: 0.75em;
			margin-top: 0.8em;
			margin-left: 1em;
			opacity: .5;

			&--error {
				color: var(--danger-color);
				opacity: 1;
			}
		}
	}
</style>
