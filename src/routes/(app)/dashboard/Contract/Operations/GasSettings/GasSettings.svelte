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

<div class="operation__gas-settings">
	<dl class="operation__gas-settings-edit">
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
		<div in:slide|global class="operation__gas-settings">
			<dl class="operation__gas-settings">
				<dt>
					<span>Minimum gas:</span>
				</dt>
				<dt>
					<Textbox
						className="operation__input-field"
						type="number"
						bind:value={gas.minimum}
					/>
				</dt>
			</dl>

			<dl class="ooperation__gas-settings">
				<dt>
					<span>Maximum gas:</span>
				</dt>
				<dt>
					<Textbox
						className="operation__input-field"
						type="number"
						bind:value={gas.maximum}
					/>
				</dt>
			</dl>
		</div>
	{/if}
</div>

<style lang="postcss">
	.operation__gas-settings {
		display: flex;
		flex-direction: column;
		gap: 0.625em;
	}

	.operation__gas-settings-edit {
		display: flex;
		flex-direction: row;
		justify-content: space-between;
	}

	:global(.operation__gas-settings .operation__input-field) {
		width: 100%;
		padding: 0.5em 1em;
	}
</style>
