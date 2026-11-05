<script>
  import QrScanner from "qr-scanner";
  import { Button } from "$lib/dusk/components";
  import { createEventDispatcher, onDestroy, onMount } from "svelte";

  /** The longest side of a camera's frame as it's read, in pixels. */
  const READ_SIDE = 800;

  /** @type {number} */
  let timeoutId;

  /** @type {boolean} */
  let toggleScanner = false;

  /** @type {boolean} */
  let qrScanned = false;

  /** @type {boolean} */
  let error = false;

  /** What's wrong with the last code read, or the image chosen. */
  let problem = "";

  /** @type {HTMLVideoElement} */
  let video;

  /** @type {HTMLDivElement} */
  let overlay;

  /** @type {HTMLInputElement} */
  let fileInput;

  /** @type {QrScanner | undefined} */
  export let scanner;

  /** Whether there's a camera to scan with: else an image is read. */
  export let hasCamera = false;

  /**
   * What's wrong with a code read, in words: "" for one that's taken. One
   * that isn't is said, and the camera reads on.
   *
   * @type {(text: string) => string}
   */
  export let check = () => "";

  /**
   * The whole of the camera's frame, made smaller to read fast: a code that
   * fills the view has its corners there.
   *
   * @param {HTMLVideoElement} frame
   */
  function wholeFrame({ videoHeight, videoWidth }) {
    const scale = Math.min(1, READ_SIDE / Math.max(videoWidth, videoHeight));

    return {
      downScaledHeight: Math.max(1, Math.round(videoHeight * scale)),
      downScaledWidth: Math.max(1, Math.round(videoWidth * scale)),
      height: videoHeight,
      width: videoWidth,
      x: 0,
      y: 0,
    };
  }

  /** Opens the browser's file picker, for an image of a code. */
  const chooseImage = () => fileInput?.click();

  /**
   * Scans with the camera, or where there's none, opens the file picker
   * at once, as the press that asked for it lets it.
   */
  export const startScan = async () => {
    error = false;
    qrScanned = false;
    problem = "";
    toggleScanner = true;
    clearTimeout(timeoutId);

    if (!scanner) {
      chooseImage();

      return;
    }

    try {
      await scanner.start();
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
    problem = "";
    scanner?.stop();
  };

  /**
   * A code read: given once, then the scanner closes. One the page doesn't
   * take is said, and it reads on.
   *
   * @param {string} data
   */
  function take(data) {
    if (!data || qrScanned) {
      return;
    }

    const wrong = check(data);

    if (wrong) {
      problem = wrong;

      return;
    }

    qrScanned = true;
    problem = "";
    dispatch("scan", data);
    timeoutId = window.setTimeout(stopScan, 200);
  }

  /** @param {QrScanner.ScanResult} result */
  const onDecodedQr = (result) => take(result.data);

  /** @param {Event} event */
  async function readImage(event) {
    const input = /** @type {HTMLInputElement} */ (event.currentTarget);
    const [file] = input.files ?? [];

    // The same file can be chosen again.
    input.value = "";

    if (!file) {
      return;
    }

    problem = "";

    try {
      const { data } = await QrScanner.scanImage(file, {
        returnDetailedScanResult: true,
      });

      take(data);
    } catch {
      problem = "No QR code found in that image.";
    }
  }

  onMount(async () => {
    hasCamera = await QrScanner.hasCamera();

    if (hasCamera) {
      scanner = new QrScanner(video, onDecodedQr, {
        calculateScanRegion: wholeFrame,
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
  class:scan--image={!hasCamera}
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
  {:else if problem}
    <p class="scan__notice" role="alert">{problem}</p>
  {:else}
    <p class="scan__notice">
      {hasCamera
        ? "Point your camera at a QR code."
        : "Choose an image of a QR code."}
    </p>
  {/if}

  <div class="scan__actions">
    <Button
      on:click={chooseImage}
      size="small"
      text="Choose image"
      variant="secondary"
    />
    <Button size="small" on:click={() => stopScan()} text="Close" />
  </div>
  <input
    accept="image/*"
    aria-label="Image of a QR code"
    bind:this={fileInput}
    class="scan__file"
    hidden
    on:change={readImage}
    type="file"
  />
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
    &--error &__highlight,
    &--image video,
    &--image &__highlight {
      display: none;
    }

    &__notice {
      margin: 0;
      text-align: center;
    }

    /* With no video above it, in the middle. */
    &--error &__notice,
    &--image &__notice {
      margin: auto 0;
    }

    &__actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--small-gap);
      justify-content: center;
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
