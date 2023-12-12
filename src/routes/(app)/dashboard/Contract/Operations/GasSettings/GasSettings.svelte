<script>
	import { slide } from "svelte/transition";
	import { mdiGasStationOutline } from "@mdi/js";
	import { Button, Icon, Textbox } from "$lib/dusk/components";
	import { createEventDispatcher } from "svelte";

	const dispatch = createEventDispatcher();

	const gas = {
		maximum: 0,
		minimum: 0
	};

	let gasSettings = false;
</script>

<div class="operation__rewards__review">
	<dl class="operation__rewards__edit-gas">
		<dt class="dusk-status-list__key">
			<Icon path={mdiGasStationOutline}/>
			<span>Default Gas Settings</span>
		</dt>
		<dd>
			<Button
				size="small"
				variant={gasSettings ? "secondary" : "tertiary"}
				on:click={() => {
					gasSettings = !gasSettings;

					if (!gasSettings) {
						dispatch("setGasSettings", gas);
					}
				}}
				text={gasSettings ? "SAVE" : "EDIT"}
			/>
		</dd>
	</dl>
	{#if gasSettings}
		<div in:slide|global out:slide|global>
			<dl class="operation__rewards__review">
				<dt>
					<span>Minimum gas:</span>
				</dt>
				<dt>
					<Textbox
						className="operation__input__field"
						type="number"
						bind:value={gas.minimum}
					/>
				</dt>
			</dl>

			<dl class="operation__rewards__review">
				<dt>
					<span>Maximum gas:</span>
				</dt>
				<dt>
					<Textbox
						className="operation__input__field"
						type="number"
						bind:value={gas.maximum}
					/>
				</dt>
			</dl>
		</div>
	{/if}
</div>

<style lang="postcss">
	.operation__rewards__review {
		display: flex;
		flex-direction: column;
		gap: 0.625em;
	}

	.operation__rewards__edit-gas {
		display: flex;
		flex-direction: row;
		justify-content: space-between;
	}

	:global(.operation__rewards__review .operation__input__field) {
		width: 100%;
		padding: 0.5em 1em;
	}
</style>
