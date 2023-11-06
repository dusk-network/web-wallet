<svelte:options immutable={true}/>

<script>
	import { fade } from "svelte/transition";
	import TermsOfService from "../TermsOfService.svelte";
	export let step = "TermsOfService";
</script>

{#if step === "TermsOfService"}
	<div class="onboarding_wrapper" in:fade|global>
		<TermsOfService/>
	</div>
{/if}

<style>
	.onboarding_wrapper {
		height: 100%;
	}
</style>
