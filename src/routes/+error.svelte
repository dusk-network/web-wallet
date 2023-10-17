<svelte:options immutable={true}/>

<script>
	import { page } from "$app/stores";

	const { error, status } = $page;
</script>

<div id="error-box">
	<h1>Error - {status} {error?.message ?? ""}</h1>
</div>

<style lang="postcss">
	#error-box {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
	}
</style>
