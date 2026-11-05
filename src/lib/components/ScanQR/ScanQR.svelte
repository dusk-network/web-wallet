<script>
  import QrScanner from "qr-scanner";
  import { Button } from "$lib/dusk/components";
  import { createEventDispatcher, onDestroy, onMount } from "svelte";

  /** @type {number} */
  let timeoutId;

  /** @type {boolean} */
  let toggleScanner = false;

  /** @type {boolean} */
  let qrScanned = false;

  /** @type {boolean} */
  let error = false;

  /** @type {HTMLVideoElement} */
  let video;

  /** @type {HTMLDivElement} */
  let overlay;

  /** @type {QrScanner | undefined} */
  export let scanner;

  export const startScan = async () => {
    error = false;
    qrScanned = false;
    toggleScanner = true;
    clearTimeout(timeoutId);

    try {
      await scanner?.start();
    } catch {
      // Refused, or taken by something else: nothing's going to scan.
      error = true;
    }
  };

  const dispatch = createEventDispatcher();
  const stopScan = () => {
    toggleScanner = false;
    qrScanned = false;
    error = false;
    scanner?.stop();
  };

  /** @param {QrScanner.ScanResult} result */
  const onDecodedQr = (result) => {
    if (result.data && !qrScanned) {
      qrScanned = true;
      dispatch("scan", result.data);
      timeoutId = window.setTimeout(stopScan, 200);
    }
  };

  onMount(async () => {
    const hasCamera = await QrScanner.hasCamera();

    if (hasCamera) {
      scanner = new QrScanner(video, onDecodedQr, {
        highlightScanRegion: true,
        maxScansPerSecond: 5,
        overlay: overlay,
        returnDetailedScanResult: true,
      });
    }
  });

  onDestroy(() => {
    clearTimeout(timeoutId);
    scanner?.destroy();
  });
</script>

<!-- The video stays through an error, for the scanner made with it to scan
  again. -->
<div
  aria-label="Scan a QR code"
  class="scan"
  class:scan--error={error}
  class:scan--visible={toggleScanner}
  role="group"
>
  <video bind:this={video}>
    <track kind="captions" />
  </video>
  <div
    bind:this={overlay}
    class="scan__highlight"
    class:scan__highlight--scanned={qrScanned}
  ></div>
  {#if error}
    <p class="scan__notice" role="alert">
      Couldn't start the camera. Allow it for this site in your browser, or
      paste the address instead.
    </p>
  {/if}

  <Button size="small" on:click={() => stopScan()} text="Close" />
</div>

<style lang="postcss">
  .scan {
    display: none;
    flex-direction: column;
    max-height: 100%;
    gap: var(--default-gap);
    align-items: center;
    justify-content: center;

    &--visible {
      display: flex;
      position: absolute;
      left: 0px;
      top: 0px;
      background-color: var(--background-color-alt);
      border-radius: 1em;
      padding: 1em;
      width: 100%;
      min-height: 100%;
      /* Over the phone's sticky Review, under the top bar. */
      z-index: 5;
      video {
        width: 100%;
        margin: auto 0;
        height: 100%;
        overflow: hidden;
      }
    }

    &--error video,
    &--error &__highlight {
      display: none;
    }

    &__notice {
      margin: auto 0;
      text-align: center;
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
