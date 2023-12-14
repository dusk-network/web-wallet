<svelte:options immutable={true}/>

<script>
	import {
		Anchor, AnchorButton, Button, Card, Textbox
	} from "$lib/dusk/components";
	import { mdiKeyOutline } from "@mdi/js";
	import { goto } from "$app/navigation";
	import { validateMnemonic } from "bip39";

	import { decryptMnemonic, getSeedFromMnemonic } from "$lib/wallet";
	import { getWallet } from "$lib/services/wallet";
	import loginInfoStorage from "$lib/services/loginInfoStorage";

	/** @type {(mnemonic: string) => Promise<Uint8Array>} */
	const getSeedFromMnemonicAsync = async mnemonic => (
		validateMnemonic(mnemonic)
			? getSeedFromMnemonic(mnemonic)
			: Promise.reject("Invalid mnemonic")
	);

	/** @type {(loginInfo: MnemonicEncryptInfo) => (pwd: string) => Promise<Uint8Array>} */
	const getSeedFromInfo = loginInfo => pwd => decryptMnemonic(loginInfo, pwd).then(getSeedFromMnemonic);

	const loginInfo = loginInfoStorage.get();
	const modeLabel = loginInfo ? "Password" : "Mnemonic phrase";

	/** @type {Textbox} */
	let fldSecret;

	let secretText = "";

	let errorMessage = "";

	/** @type {import("svelte/elements").FormEventHandler<HTMLFormElement>} */
	function handleUnlockWalletSubmit () {
		const getSeed = loginInfo ? getSeedFromInfo(loginInfo) : getSeedFromMnemonicAsync;

		getSeed(secretText.trim())
			.then(getWallet)
			.then(() => {
				goto("/dashboard");
			})
			.catch(() => {
				errorMessage = `Wrong ${modeLabel.toLowerCase()}`;
				fldSecret.focus();
				fldSecret.select();
			});
	}
</script>

<section class="login-content">
	<h1>
		Unleash <mark>RWA</mark> and<br/>
		<mark>Decentralized Finance</mark>
	</h1>

	<Card iconPath={mdiKeyOutline} heading={modeLabel}>
		<form
			class="login-content__form"
			on:submit|preventDefault={handleUnlockWalletSubmit}
		>
			<Textbox
				bind:this={fldSecret}
				bind:value={secretText}
				name="secret"
				placeholder={modeLabel}
				required
				type="password"
			/>
			{#if errorMessage}
				<span class="login-content__error">{errorMessage}</span>
			{/if}
			<Button variant="secondary" text="Unlock Wallet" type="submit"/>
			{#if modeLabel === "Password"}
				<AnchorButton variant="text" href="/setup/restore" text="Forgot Password?"/>
			{/if}
		</form>
	</Card>
</section>

<footer class="login-footer">
	<p>Need help? Contact <Anchor href="#">DUSK support</Anchor></p>
</footer>

<style lang="postcss">
	.login-content,
	.login-content__form {
		display: flex;
		flex-direction: column;
	}

	.login-content {
		gap: var(--large-gap);

		&__form {
			gap: var(--default-gap);
		}

		&__error {
			color: var(--error);
		}
	}

	.login-footer {
		margin-top: auto;
	}
</style>
