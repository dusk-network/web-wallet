<script>
	import { fade } from "svelte/transition";
	import { Button } from "$lib/dusk/components";
	import ContractOperations from "./Contract/Operations.svelte";
	import {
		Receive,
		Send,
		Stake,
		Withdraw,
		WithdrawRewards
	} from "./Contract/Operations";
	import { operationsStore } from "$lib/contracts";
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
			props: undefined
		},
		{
			component: Withdraw,
			id: "withdraw",
			props: undefined
		},
		{
			component: WithdrawRewards,
			id: "withdraw-rewards",
			props: undefined
		},
		{
			component: Receive,
			id: "receive",
			props: {
				// eslint-disable-next-line max-len
				publicSpendKey: "Y05MCvisx3hIhGq50gQ7rZRmQKiIO03ly8DsVqKmU5cmIO1B7CKXPH2dtSC5sk6vmXJZ27qSMPfFsW"
			}
		},
		{
			component: Send,
			id: "send",
			props: undefined
		}
	];

	$: ({ currentOperation } = $operationsStore);
	$: ({ heading, statuses } = contract);

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
		/>
	{:else}
		<ContractOperations {statuses} {heading}>
			{#each operations as operation, index (operation.id)}
				<Button
					className="operations__operation"
					variant="secondary"
					on:click={() => operationsStore.update(store => ({ ...store, currentOperation: index }))}
					icon={operation.icon}
					text={operation.label}
				/>
			{/each}
		</ContractOperations>
	{/if}
</div>
