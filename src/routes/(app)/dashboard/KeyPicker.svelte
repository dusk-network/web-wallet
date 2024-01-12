<svelte:options immutable={true}/>

<script>
	import { createEventDispatcher, onMount	} from "svelte";
	import { calculateAdaptiveCharCount, makeClassName, middleEllipsis } from "$lib/dusk/string";
	import {
		mdiContentCopy, mdiPlusBoxOutline, mdiSwapHorizontal, mdiTimerSand
	} from "@mdi/js";
	import {
		Button, CircularIcon, Icon, ProgressBar
	} from "$lib/dusk/components";
	import { toast } from "$lib/dusk/components/Toast/store";
	import { handlePageClick } from "$lib/dusk/ui-helpers/handlePageClick";

	import "./KeyPicker/KeyPicker.css";
	import Overlay from "./Overlay.svelte";

	/** @type {String} */
	export let currentKey;

	/** @type {String[]} */
	export let keys = [currentKey];

	export let generatingKey = false;

	/** @type {String | Undefined} */
	export let className = undefined;

	$: classes = makeClassName(["key-picker", className]);

	const dispatch = createEventDispatcher();

	let expanded = false;

	function toggle () {
		expanded = !expanded;
	}

	function closeDropDown () {
		expanded = false;
	}

	// Scrolls the key options menu to top on keys change
	$: if (keys && keyOptionsMenu) {
		keyOptionsMenu.scrollTo(0, 0);
	}

	/** @type {import("svelte/elements").KeyboardEventHandler<HTMLDivElement>} */
	function handleDropDownKeyDown	(event) {
		if (event.key === "Enter" || event.key === " ") {
			toggle();
		}

		if (event.key === "Escape") {
			closeDropDown();
		}
	}

	/** @type {Number} */
	let screenWidth = window.innerWidth;

	onMount(() => {
		const resizeObserver = new ResizeObserver(entries => {
			const entry = entries[0];

			screenWidth = entry.contentRect.width;
		});

		resizeObserver.observe(document.body);

		return () => resizeObserver.disconnect();
	});

	/** @type {HTMLMenuElement} */
	let keyOptionsMenu;
</script>

{#if expanded}
	<Overlay/>
{/if}

<div
	use:handlePageClick={{ callback: closeDropDown, enabled: expanded }}
	class={classes}
	class:key-picker--expanded={expanded}>

	<div
		class="key-picker__trigger"
		role="button"
		tabindex="0"
		aria-haspopup="true"
		aria-expanded={expanded}
		on:keydown={handleDropDownKeyDown}>
		<CircularIcon color="var(--background-color)" bgColor="var(--primary-color)">
			<Icon path={mdiSwapHorizontal} size="large"/>
		</CircularIcon>
		<p class="key-picker__current-key">{middleEllipsis(
			currentKey,
			calculateAdaptiveCharCount(screenWidth)
		)}</p>
		<span class="key-picker__copy-key-button-wrapper">
			<Button
				aria-label="Copy Key"
				className="key-picker__copy-key-button"
				icon={{ path: mdiContentCopy }}
				on:click={() => {
					navigator.clipboard.writeText(currentKey);
					toast("success", "Address copied", mdiContentCopy);
				}}
				variant="text"
			/>
		</span>
	</div>

	{#if expanded}
		<div class="key-picker__drop-down">
			<hr/>
			<menu class="key-picker__key-options" bind:this={keyOptionsMenu}>
				{#each keys as key (key)}
					<li
						class="key-picker__key"
						class:key-picker__key--selected={key === currentKey}>
						<button
							class="key-picker__key-option-button"
							tabindex="0"
							type="button"
							role="menuitem"
							on:click={() => {
								currentKey = key;
								closeDropDown();
							}}>{key}</button>
					</li>
				{/each}
			</menu>
			<hr/>
			{#if generatingKey}
				<div class="key-picker__generating-key-wrapper">
					<Icon path={mdiTimerSand}/>
					<p>Generating new <b>Key</b></p>
				</div>
				<ProgressBar/>
			{:else}
				<Button
					tabindex="0"
					className="key-picker__generate-key-button"
					variant="secondary"
					icon={{ path: mdiPlusBoxOutline }}
					text="Generate Key"
					on:click={async (event) => {
						event.preventDefault();
						dispatch("generateKey");
					}}/>
			{/if}
		</div>
	{/if}
</div>
