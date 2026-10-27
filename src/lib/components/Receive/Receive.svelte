<svelte:options immutable={true} />

<script>
  import {
    mdiAlertOutline,
    mdiArrowLeft,
    mdiContentCopy,
    mdiInformationOutline,
  } from "@mdi/js";
  import { onMount } from "svelte";

  import { AppAnchorButton } from "$lib/components";
  import { Icon, QrCode } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import { randomUUID, shortenAddress } from "$lib/dusk/string";

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
   * Copies the name or the full address, saying whether that worked.
   *
   * @param {string} value
   * @param {"Address" | "Name"} what
   */
  async function copy(value, what) {
    try {
      await navigator.clipboard.writeText(value);
      toast("success", `${what} copied`, mdiContentCopy);
    } catch (err) {
      toast(
        "error",
        err instanceof Error && err.name === "NotAllowedError"
          ? "Clipboard access denied"
          : `Failed to copy ${what.toLowerCase()}`,
        mdiAlertOutline
      );
    }
  }

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
</script>

<div class="receive">
  <figure class="receive__address-qr-figure" bind:this={figureElement}>
    <QrCode
      value={address}
      className="receive__qr"
      width={Math.min(qrWidth, maxQrWidth)}
    />

    <!-- The name, when there is one to show with the address, and the
      address, shortened, each on one line with a button to copy it. -->
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
            <button
              aria-label="Copy name"
              class="receive__icon-button receive__copy-button"
              title="Copy name"
              type="button"
              on:click={() => copy(shownName, "Name")}
            >
              <Icon path={mdiContentCopy} />
            </button>
          </div>
        {/if}
      {:catch}
        <!-- A failed lookup shows no name. -->
      {/await}
      <div class="receive__field">
        <samp class="receive__address" title={address}>
          <span aria-hidden="true">{shortenAddress(address)}</span>
          <span class="sr-only">{address}</span>
        </samp>
        <button
          aria-label="Copy address"
          class="receive__icon-button receive__copy-button"
          title="Copy address"
          type="button"
          on:click={() => copy(address, "Address")}
        >
          <Icon path={mdiContentCopy} />
        </button>
      </div>
      <p class="receive__reveal">
        {addressType === "account"
          ? "Anyone with this address, or a name that points to it, can see its balance and every public payment to and from it."
          : "Payments to this shielded address don't show on chain who receives them or how much. Whoever pays you sees what they send."}
      </p>
      {#await name then shownName}
        {#if shownName}
          <p class="receive__note" hidden={!isNoteShown} id={noteId}>
            {getNote(shownName, addressType)}
          </p>
        {/if}
      {:catch}
        <!-- A failed lookup shows no name. -->
      {/await}
    </figcaption>
  </figure>

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
    &__name,
    &__address {
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

    &__address {
      color: var(--muted-color);
      font-size: 0.8125rem;
    }

    &__icon-button {
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

    &__copy-button {
      margin-left: auto;
    }

    /* On phones, taps of at least 44 px. */
    @media (max-width: 30rem) {
      &__icon-button {
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
