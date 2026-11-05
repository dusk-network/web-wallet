<svelte:options immutable={true} />

<script>
  import {
    mdiAlertOutline,
    mdiArrowLeft,
    mdiInformationOutline,
    mdiShareVariantOutline,
    mdiTrayArrowDown,
  } from "@mdi/js";
  import * as QRCode from "qrcode";
  import { onMount } from "svelte";

  import { displayText } from "@dusk-network/app-core/text";

  import { AppAnchorButton, FullAddress } from "$lib/components";
  import { Button, CopyButton, Icon, QrCode } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import { formatDuskExact } from "$lib/dusk/currency";
  import { section } from "$lib/dusk/motion";
  import { randomUUID, shortenAddress } from "$lib/dusk/string";
  import { settingsStore } from "$lib/stores";

  /** @type {string} */
  export let address = "";

  /** @type {boolean} */
  export let hideBackButton = false;

  /**
   * The `.dusk` name shown with the address, or its lookup: "" for none.
   *
   * @type {string | Promise<string>}
   */
  export let name = "";

  /**
   * What the address is to the name shown with it: the public account
   * the name points to, or a shielded address the name also lists.
   *
   * @type {"account" | "address"}
   */
  export let addressType = "account";

  /**
   * What's asked of whoever pays, in place of the address alone: what the QR
   * holds, the link Share sends, and what's in them, for the picture's words.
   *
   * @type {{ dusk: string, link: string, lux?: bigint | null, memo?: string } | null}
   */
  export let request = null;

  /** Called as the request leaves the wallet, by Share or Download QR. */
  /** @type {() => void} */
  export let onUse = () => {};

  // Where a browser has a share sheet: most phones, some computers.
  const canShare = typeof navigator.share === "function";

  /** @type {HTMLElement} */
  let figureElement;

  // The QR code's widest, in CSS pixels: easy to scan, and leaving the
  // fields under it close by.
  const maxQrWidth = 240;

  let qrWidth = 0;

  // Whether the note on what the name reaches is shown.
  let isNoteShown = false;

  const noteId = `${randomUUID()}-name-note`;

  onMount(() => {
    const resizeObserver = new ResizeObserver((entries) => {
      qrWidth = entries[0].contentRect.width;
    });

    resizeObserver.observe(figureElement);

    return () => resizeObserver.disconnect();
  });

  /**
   * What the name reaches, for the note behind its info button.
   *
   * @param {string} shownName
   * @param {"account" | "address"} type
   */
  const getNote = (shownName, type) =>
    type === "account"
      ? `People who send to ${shownName} reach this public account.`
      : `People who pay ${shownName} choose public or shielded. Anyone can see this address belongs to ${shownName}.`;

  /** The address, or what's asked, through the phone's share sheet. */
  async function share() {
    const text = request?.link ?? address;

    try {
      await navigator.share({
        text,
        title: request ? "Dusk payment request" : "My Dusk address",
      });
      onUse();
    } catch (error) {
      // Closing the sheet is an answer, not a failure.
      if (error instanceof Error && error.name !== "AbortError") {
        toast("error", "Couldn't share that", mdiAlertOutline);
      }
    }
  }

  /** The picture's width, and its margin, in pixels. */
  const PICTURE = 1024;
  const MARGIN = 64;

  /**
   * A line as wide as the picture takes, cut short with an ellipsis.
   *
   * @param {CanvasRenderingContext2D} context
   * @param {string} text
   */
  function fitted(context, text) {
    const room = PICTURE - 2 * MARGIN;
    let line = text;

    while (line.length > 1 && context.measureText(line).width > room) {
      line = line.slice(0, -2);
    }

    return line === text ? line : `${line.trimEnd()}…`;
  }

  /**
   * What a request asks, in words under its QR: what it is, the amount, the
   * memo, and the account it pays, by its name where it has one.
   *
   * @param {NonNullable<typeof request>} asked
   * @param {string} shownName
   * @returns {Array<{ size: number, text: string, weight: number }>}
   */
  const wordsOf = (asked, shownName) => [
    { size: 44, text: "Dusk payment request", weight: 600 },
    {
      size: 64,
      text:
        asked.lux === null || asked.lux === undefined
          ? "Any amount"
          : `${formatDuskExact(asked.lux, $settingsStore.language)} DUSK`,
      weight: 600,
    },
    ...(asked.memo
      ? [{ size: 40, text: displayText(asked.memo).text, weight: 400 }]
      : []),
    {
      size: 36,
      text: `To ${shownName ? `${shownName} · ` : ""}${shortenAddress(address)}`,
      weight: 400,
    },
  ];

  /**
   * What the QR holds, as a picture large enough to print: for a request,
   * with what it asks written under it, for whoever gets the picture alone.
   */
  async function qrPicture() {
    const qr = document.createElement("canvas");

    await QRCode.toCanvas(qr, qrValue, {
      color: { dark: "#101", light: "#fff" },
      width: PICTURE,
    });

    if (!request) {
      return qr.toDataURL("image/png");
    }

    const shownName = await Promise.resolve(name).catch(() => "");
    const lines = wordsOf(request, shownName);
    const picture = document.createElement("canvas");
    const context = /** @type {CanvasRenderingContext2D} */ (
      picture.getContext("2d")
    );
    const font = getComputedStyle(document.body).fontFamily || "sans-serif";

    picture.width = PICTURE;
    picture.height =
      PICTURE +
      lines.reduce((height, { size }) => height + size * 1.5, 0) +
      MARGIN;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, picture.width, picture.height);
    context.drawImage(qr, 0, 0, PICTURE, PICTURE);
    context.fillStyle = "#101";
    context.textAlign = "center";
    context.textBaseline = "top";

    let top = PICTURE;

    for (const { size, text, weight } of lines) {
      context.font = `${weight} ${size}px ${font}`;
      context.fillText(fitted(context, text), PICTURE / 2, top);
      top += size * 1.5;
    }

    return picture.toDataURL("image/png");
  }

  /** The QR as a picture, downloaded. */
  async function downloadQr() {
    try {
      const link = document.createElement("a");

      link.href = await qrPicture();
      link.download = `dusk-${addressType === "account" ? "public" : "shielded"}-${request ? "request" : "receive"}-qr.png`;
      link.click();
      onUse();
    } catch {
      toast("error", "Couldn't make the QR picture", mdiAlertOutline);
    }
  }

  $: qrValue = request?.dusk ?? address;
</script>

<div class="receive">
  <figure class="receive__address-qr-figure" bind:this={figureElement}>
    <QrCode
      alt={request
        ? "QR code for your payment request"
        : addressType === "account"
          ? "QR code for your public account"
          : "QR code for your shielded address"}
      value={qrValue}
      className="receive__qr"
      width={Math.min(qrWidth, maxQrWidth)}
    />

    <!-- The name, when there is one to show with the address, on one line
      with a button to copy it, and the address in full, to read and to copy. -->
    <figcaption class="receive__fields">
      {#await name then shownName}
        {#if shownName}
          <div class="receive__field">
            <span class="receive__name" title={shownName}>{shownName}</span>
            <button
              aria-controls={noteId}
              aria-expanded={isNoteShown}
              aria-label="About this name"
              class="receive__icon-button"
              title="About this name"
              type="button"
              on:click={() => {
                isNoteShown = !isNoteShown;
              }}
            >
              <Icon path={mdiInformationOutline} />
            </button>
            <CopyButton
              className="receive__icon-button receive__copy-button"
              name="name"
              title="Copy name"
              value={shownName}
            />
          </div>
        {/if}
      {:catch}
        <!-- A failed lookup shows no name. -->
      {/await}
      <p class="receive__full-address"><FullAddress {address} /></p>
      <CopyButton
        className="receive__copy-address"
        name="address"
        text="Copy address"
        value={address}
        variant="secondary"
      />
      <div class="receive__share">
        {#if canShare}
          <Button
            icon={{ path: mdiShareVariantOutline }}
            on:click={share}
            text="Share"
            variant="secondary"
          />
        {/if}
        <Button
          icon={{ path: mdiTrayArrowDown }}
          on:click={downloadQr}
          text="Download QR"
          variant="secondary"
        />
      </div>
      <p class="receive__reveal">
        {addressType === "account"
          ? "Anyone with this address, or a name that points to it, can see its balance and every public payment to and from it."
          : "Payments to this shielded address don't show on chain who receives them or how much. Whoever pays you sees what they send."}
      </p>
      {#await name then shownName}
        {#if shownName && isNoteShown}
          <p
            class="receive__note"
            id={noteId}
            transition:section={{ open: isNoteShown }}
          >
            {getNote(shownName, addressType)}
          </p>
        {/if}
      {:catch}
        <!-- A failed lookup shows no name. -->
      {/await}
    </figcaption>
  </figure>

  <slot />

  {#if !hideBackButton}
    <div class="receive__buttons">
      <AppAnchorButton
        className="receive__button"
        icon={{ path: mdiArrowLeft }}
        href="/dashboard"
        text="Back"
        variant="tertiary"
      />
    </div>
  {/if}
</div>

<style lang="postcss">
  .receive {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    gap: var(--default-gap);
    z-index: 3;

    &__address-qr-figure {
      display: flex;
      flex-direction: column;
      gap: var(--default-gap);
      align-items: center;
      width: 100%;
    }

    /* As wide as its width attribute says, centered in the figure. */
    :global(&__qr) {
      border-radius: var(--control-border-radius-size);
      max-width: 100%;
      padding: 0.625em;
      background-color: var(--surface-soft-color);
      border: 1px solid var(--surface-border-color);
    }

    &__fields {
      display: flex;
      flex-direction: column;
      gap: var(--small-gap);
      width: 100%;
    }

    &__full-address {
      text-align: center;
    }

    :global(&__copy-address) {
      width: 100%;
    }

    &__share {
      display: flex;
      gap: var(--small-gap);
      width: 100%;

      & :global(.dusk-button) {
        flex: 1;
      }
    }

    &__field {
      display: flex;
      align-items: center;
      gap: 0.25em;
      min-width: 0;
      padding: 0.25em 0.25em 0.25em 1em;
      background-color: var(--surface-soft-color);
      border: 1px solid var(--surface-border-color);
      border-radius: var(--control-border-radius-size);
    }

    /* Both stay on one line: a long name ends in an ellipsis. */
    &__name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &__name {
      color: var(--on-surface-color);
      font-family: var(--main-font-family);
      font-size: 1rem;
      font-weight: 500;
    }

    :global(&__icon-button) {
      all: unset;
      display: flex;
      flex-shrink: 0;
      align-items: center;
      justify-content: center;
      width: 2em;
      height: 2em;
      border-radius: var(--control-border-radius-size);
      color: var(--muted-color);
      cursor: pointer;
      transition:
        background-color 0.2s ease,
        color 0.2s ease;

      &:hover,
      &[aria-expanded="true"] {
        background-color: var(--control-secondary-bg-color-hover);
        color: var(--on-surface-color);
      }

      &:focus-visible {
        outline: 2px solid var(--secondary-color);
      }
    }

    :global(&__copy-button) {
      margin-left: auto;
    }

    /* On phones, taps of at least 44 px. */
    @media (max-width: 30rem), (pointer: coarse) {
      :global(&__icon-button) {
        width: 44px;
        height: 44px;
      }
    }

    &__reveal {
      margin: 0;
      color: var(--calm-muted);
      font-size: 0.8125rem;
      line-height: 1.45;
      text-align: center;
    }

    &__note {
      color: var(--muted-color);
      font-size: 0.8125rem;
      overflow-wrap: anywhere;
    }

    :global(&__button) {
      flex: 1;
    }

    &__buttons {
      display: flex;
      flex-direction: row;
      gap: var(--default-gap);
      width: 100%;
    }
  }
</style>
