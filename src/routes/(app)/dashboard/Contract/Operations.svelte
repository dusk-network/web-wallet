<script>
	import { StatusList } from "$lib/dusk/components";

	/** @type {Status[]} */
	export let statuses;

	/** @type {string} */
	export let heading;
</script>

<div class="operations">
	<h2 class="h4">{heading}</h2>
	<StatusList {statuses}/>
	<slot/>
</div>
