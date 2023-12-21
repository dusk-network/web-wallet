<script>
	import { fade } from "svelte/transition";
	import { Button } from "$lib/dusk/components";
	import ContractOperations from "./Contract/Operations.svelte";
	import {
		Receive,
		Send,
		Stake
	} from "./Contract/Operations";
	import { operationsStore, walletStore } from "$lib/stores";
	import { onDestroy } from "svelte";

	/** @type Contract */
	export let contract;

	onDestroy(async () => {
		$operationsStore.currentOperation = undefined;
	});

	/**
	 * @type {Array<{ component: import("svelte").ComponentType, id: string, props?: Record<string, any> }>}
	 */
	const allOperations = [
		{
			component: Stake,
			id: "stake",
			props: { flow: "stake" }
		},
		{
			component: Stake,
			id: "withdraw-stake",
			props: { flow: "withdraw-stake" }
		},
		{
			component: Stake,
			id: "withdraw-rewards",
			props: { flow: "withdraw-rewards" }
		},
		{
			component: Send,
			id: "send",
			props: undefined
		},
		{
			component: Receive,
			id: "receive",
			props: {
				// eslint-disable-next-line max-len
				publicSpendKey:
					"Y05MCvisx3hIhGq50gQ7rZRmQKiIO03ly8DsVqKmU5cmIO1B7CKXPH2dtSC5sk6vmXJZ27qSMPfFsW"
			}
		}
	];

	$: ({ currentOperation } = $operationsStore);
	$: ({ isSyncing, error } = $walletStore);
	$: ({ statuses } = contract);

	const { operations } = contract;
	const contractOperations = allOperations.filter((a) => {
		return operations.some((b) => {
			return b.id === a.id;
		});
	});
</script>

<div in:fade|global class="contract">
	{#if typeof currentOperation === "number" && contractOperations[currentOperation]}
		<svelte:component
			this={contractOperations[currentOperation].component}
			{...contractOperations[currentOperation].props}
			{statuses}
		/>
	{:else}
		<ContractOperations {statuses}>
			{#each operations as operation, index (operation.id)}
				<Button
					disabled={operation.label !== "receive" && (isSyncing || error)}
					className="operations__operation"
					variant={operation.variant ?? "secondary"}
					on:click={() =>
						operationsStore.update((store) => ({
							...store,
							currentOperation: index
						}))}
					icon={operation.icon}
					text={operation.label}
				/>
			{/each}
		</ContractOperations>
	{/if}
</div>
