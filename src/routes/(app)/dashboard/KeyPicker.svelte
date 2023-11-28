<svelte:options immutable={true}/>

<script>
	import { createEventDispatcher	} from "svelte";
	import { makeClassName } from "$lib/dusk/string";
	import {
		mdiClose, mdiKeyOutline, mdiPlusBoxOutline, mdiSwapHorizontalCircle, mdiTimerSand
	} from "@mdi/js";
	import {
		Button, CircularIcon, Icon, ProgressBar
	} from "$lib/dusk/components";
	import { handlePageClick } from "$lib/dusk/ui-helpers/handlePageClick";

	import "./KeyPicker/KeyPicker.css";

	/** @type {String[]} */
	export let keys;

	/** @type {String} */
	export let currentKey;

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

	/** @type {HTMLMenuElement} */
	let keyOptionsMenu;
</script>

{#if expanded}
	<div class="overlay"></div>
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
		on:keydown={handleDropDownKeyDown}
		on:click={toggle}>
		<CircularIcon>
			<Icon path={mdiKeyOutline} size="large"/>
		</CircularIcon>
		<p class="key-picker__current-key">{currentKey}</p>
		<Icon path={expanded ? mdiClose : mdiSwapHorizontalCircle} size="large"/>
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

<style>
	.overlay {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: transparent;
		z-index: 1;
		backdrop-filter: blur(2px);
	}
</style>
