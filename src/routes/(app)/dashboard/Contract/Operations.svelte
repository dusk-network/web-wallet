<script>
	import { StatusList } from "$lib/dusk/components";

	/** @type {Status[]} */
	export let statuses;
</script>

<div class="operations">
	<StatusList {statuses}/>
	<slot/>
</div>
