<script>

	/** @type {number | undefined} */
	export let currentPercentage = undefined;
</script>

<div role="progressbar" class="duk-progress-bar">
	<div
		style={currentPercentage !== undefined
			? `width: ${currentPercentage}%`
			: undefined}
		class:duk-progress-bar__filler--undetermined={currentPercentage
			=== undefined}
		class="duk-progress-bar__filler"
	/>
</div>
