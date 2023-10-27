<svelte:options immutable={true}/>

<script>
	import { mdiChevronLeft, mdiChevronRight } from "@mdi/js";
	import { createEventDispatcher, onMount	} from "svelte";
	import { writable } from "svelte/store";

	import { Button, Icon } from "$lib/dusk/components";
	import { makeClassName } from "$lib/dusk/string";

	import "./Tabs.css";

	/** @type {String | Undefined} */
	export let className = undefined;

	/** @type {TabItem[]} */
	export let items;

	/** @type {String | Undefined} */
	export let selectedTab = undefined;

	/** @type {HTMLUListElement} */
	let tabsList;

	/** @type {Number} */
	let rafID = 0;

	const dispatch = createEventDispatcher();

	const scrollStatus = writable({
		canScroll: false,
		canScrollLeft: false,
		canScrollRight: false
	});

	// @ts-ignore
	function handleScrollButtonMouseDown (event) {
		if (event.buttons === 1) {
			const amount = event
				.currentTarget
				.matches(".duk-tab-scroll-button:first-of-type") ? -5 : 5;

			keepScrollingTabsBy(amount);
		}
	}

	function handleScrollButtonMouseUp () {
		cancelAnimationFrame(rafID);
	}

	/** @type {import("svelte/elements").UIEventHandler<HTMLLIElement>} */
	function handleTabClick (event) {
		const clickedID = event.currentTarget.dataset.tabid;

		if (selectedTab !== clickedID) {
			selectedTab = clickedID;
			dispatch("change", clickedID);
		}
	}

	/** @type {import("svelte/elements").UIEventHandler<HTMLLIElement>} */
	function handleTabFocusin (event) {
		event.currentTarget.scrollIntoView({
			behavior: "smooth",
			block: "nearest",
			inline: "nearest"
		});
	}

	/** @type {import("svelte/elements").KeyboardEventHandler<HTMLLIElement>} */
	function handleTabKeyDown (event) {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();

			handleTabClick(event);
		}
	}

	/** @param {Number} amount */
	function keepScrollingTabsBy (amount) {
		const { canScrollLeft, canScrollRight } = $scrollStatus;

		tabsList.scrollBy(amount, 0);

		if (canScrollLeft && amount < 0 || canScrollRight && amount > 0) {
			rafID = requestAnimationFrame(() => keepScrollingTabsBy(amount));
		}
	}

	function updateScrollStatus () {
		const {
			clientWidth = 0,
			scrollLeft = 0,
			scrollWidth = 0
		} = tabsList;

		const canScroll = scrollWidth > clientWidth;
		const maxScroll = scrollWidth - clientWidth;

		scrollStatus.set({
			canScroll,
			canScrollLeft: canScroll && scrollLeft > 0,
			canScrollRight: canScroll && scrollLeft < maxScroll
		});
	}

	onMount(() => {
		const resizeObserver = new ResizeObserver(() => {
			const tab = tabsList.querySelector(`[data-tabid="${selectedTab}"]`);

			tab && tab.scrollIntoView({
				behavior: "instant",
				block: "nearest",
				inline: "nearest"
			});

			updateScrollStatus();
		});

		tabsList.scrollTo(0, 0);
		resizeObserver.observe(tabsList);

		return () => resizeObserver.disconnect();
	});

	$: ({ canScroll, canScrollLeft, canScrollRight } = $scrollStatus);
</script>

<div
	{...$$restProps}
	class={makeClassName(["duk-tabs", className])}
>
	<Button
		className="duk-tab-scroll-button"
		disabled={!canScrollLeft}
		hidden={!canScroll}
		icon={{ path: mdiChevronLeft }}
		on:mousedown={handleScrollButtonMouseDown}
		on:mouseup={handleScrollButtonMouseUp}
		tabindex="-1"
	/>
	<ul
		bind:this={tabsList}
		class="duk-tabs-list"
		on:scroll={updateScrollStatus}
		role="tablist"
	>
		{#each items as item (item.id)}
			{@const { icon, id, label } = item}
			<li
				aria-selected={id === selectedTab}
				class={`duk-tab-item${id === selectedTab ? " duk-tab-item__selected" : ""}`}
				data-tabid={id}
				on:click={handleTabClick}
				on:focusin={handleTabFocusin}
				on:keydown={handleTabKeyDown}
				role="tab"
				tabindex="0"
			>
				{#if icon?.position === "after"}
					{#if label}
						<span class="duk-tab-label">{label}</span>
					{/if}
					<Icon path={icon.path}/>
				{:else if icon}
					<Icon path={icon.path}/>
					{#if label}
						<span class="duk-tab-label">{label}</span>
					{/if}
				{:else}
					<span class="duk-tab-label">{label ?? id}</span>
				{/if}
			</li>
		{/each}
	</ul>
	<Button
		className="duk-tab-scroll-button"
		disabled={!canScrollRight}
		hidden={!canScroll}
		icon={{ path: mdiChevronRight }}
		on:mousedown={handleScrollButtonMouseDown}
		on:mouseup={handleScrollButtonMouseUp}
		tabindex="-1"
	/>
</div>
