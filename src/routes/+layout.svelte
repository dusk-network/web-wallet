<script>
	import { Tooltip } from "$lib/dusk/components";
	import "../style/main.css";
</script>

<main class="app">
	<h1 class="visible-hidden">Dusk Web Wallet</h1>
	<slot/>
</main>

<Tooltip id="main-tooltip"/>

<style>
	.app {
		height: 100%;
		padding: 1.38rem;
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}
</style>
