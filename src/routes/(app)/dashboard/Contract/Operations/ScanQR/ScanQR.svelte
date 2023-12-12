<script>
	// eslint-disable-next-line import/default
	import QrScanner from "qr-scanner";
	import { Button } from "$lib/dusk/components";
	import { createEventDispatcher, onDestroy, onMount } from "svelte";

	const dispatch = createEventDispatcher();

	/** @type {number} */
	let timeoutId;

	/** @type {Boolean} */
	let toggleScanner = false;
	let qrScanned = false;
	let error = false;

	/** @type {HTMLVideoElement} */
	let video;

	/** @type {HTMLDivElement} */
	let overlay;

	/** @type {QrScanner} */
	let scanner;

	const startScan = async () => {
		try {
			toggleScanner = !toggleScanner;
			clearTimeout(timeoutId);
			scanner?.start();
		} catch (e) {
			error = !error;
		}
	};

	const stopScan = () => {
		toggleScanner = !toggleScanner;
		qrScanned = !qrScanned;
		error = !error;
		scanner?.stop();
	};

	/** @param {QrScanner.ScanResult} result */
	const onDecodedQr = (result) => {
		if (result.data) {
			qrScanned = !qrScanned;
			dispatch("scan", result.data);
			timeoutId = window.setTimeout(stopScan, 200);
		}
	};

	onMount(async () => {
		const hasCamera = await QrScanner.hasCamera();

		if (hasCamera) {
			scanner = new QrScanner(video, onDecodedQr, {
				highlightScanRegion: true,
				maxScansPerSecond: 1,
				overlay: overlay,
				returnDetailedScanResult: true
			});
		}
	});

	onDestroy(() => {
		scanner?.destroy();
	});
</script>

<div class="scan">
	<Button
		size="small"
		variant="secondary"
		on:click={() => startScan()}
		text="SCAN QR"
		disabled={!scanner}
	/>

	<div class="scan-region" class:scan-region--visible={toggleScanner}>
		{#if !error}
			<video bind:this={video}>
				<track kind="captions"/>
			</video>
			<div
				bind:this={overlay}
				class="scan-region__highlight"
				class:scan-region__highlight--scanned={qrScanned}
			></div>
		{:else}
			<div class="scan-region__notice">
				<span>An Error occurred while starting camera</span>
			</div>
		{/if}

		<Button
			size="small"
			variant="secondary"
			on:click={() => stopScan()}
			text="CLOSE"
		/>
	</div>
</div>

<style lang="postcss">
	.scan {
		z-index: 1;
	}

	.scan-region {
		display: none;
		flex-direction: column;
		max-height: 80%;
		gap: var(--default-gap);
		align-items: center;
		justify-content: center;

		&--visible {
			display: flex;
			position: absolute !important;
			left: 50%;
			top: 260px;
			transform: translateX(-50%);
			background-color: var(--background-color-alt);
			border-radius: 1.5em;
			padding: 1em;
			overflow: hidden;
			width: 100%;
			video {
				width: 100%;
				margin: auto 0;
			}
		}

		&__highlight {
			border-radius: 1em;
			outline: rgba(0, 0, 0, 0.25) dashed 2px;

			&--scanned {
				outline: #16db93 dashed 2px;
			}
		}
	}
</style>
