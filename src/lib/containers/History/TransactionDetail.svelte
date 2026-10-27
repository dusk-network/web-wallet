<script>
  import { createEventDispatcher, onMount } from "svelte";
  import {
    mdiAlertCircleOutline,
    mdiCheck,
    mdiClose,
    mdiContentCopy,
    mdiOpenInNew,
    mdiSendOutline,
    mdiTimerSand,
  } from "@mdi/js";
  import { AnchorButton, Button, Icon, Textbox } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import { BalanceValue } from "$lib/components";
  import { fetchTxNonce } from "$lib/activity/activityHistory";
  import { contractLabel } from "$lib/activity/knownContracts";
  import { fullDateTime, rowTime } from "$lib/activity/present";
  import { formatDuskExact } from "$lib/dusk/currency";
  import { addBasePath } from "$lib/navigation";
  import { addressType, contactsStore, saveContact } from "$lib/contacts";
  import { nodeBaseUrl } from "$lib/url";

  import { ACTIVITY_ICONS } from "../Home/activityIcons";

  /** @type {ActivityRow} */
  export let row;

  /** @type {import("$lib/activity/present").ActivityPresentation} */
  export let presentation;

  /** @type {string} */
  export let locale;

  /** The network's name, for the contracts the wallet names. */
  export let network = "";

  /** The account the history is of, and how the wallet names it. */
  /** @type {{ address: string, label: string } | null} */
  export let account = null;

  /** Looks a public transaction's nonce up. */
  /** @type {(hash: string) => Promise<string | null>} */
  export let loadNonce = (hash) => fetchTxNonce(nodeBaseUrl(), hash);

  const dispatch = createEventDispatcher();

  /** @type {HTMLButtonElement} */
  let closeButton;

  /** Whether the counterparty is being saved to the contacts, and as what. */
  let isSavingContact = false;
  let contactName = "";

  function saveCounterparty() {
    const name = contactName.trim();

    if (name && p.counterparty) {
      saveContact({
        address: p.counterparty,
        duskName: duskName?.endsWith(".dusk") ? duskName : null,
        name,
      });
      isSavingContact = false;
      contactName = "";
    }
  }

  /**
   * An address or hash in full, its first and last six characters set
   * apart, and the last six never split across lines.
   *
   * @param {string} value
   */
  const parts = (value) =>
    value.length > 12
      ? [value.slice(0, 6), value.slice(6, -6), value.slice(-6)]
      : ["", value, ""];

  /**
   * @param {string} value
   * @param {string} [what]
   */
  async function copy(value, what = "transaction ID") {
    try {
      await navigator.clipboard.writeText(value);
      toast(
        "success",
        `${what[0].toUpperCase()}${what.slice(1)} copied`,
        mdiContentCopy
      );
    } catch {
      toast("error", `Couldn't copy the ${what}`, mdiAlertCircleOutline);
    }
  }

  /**
   * The row the nonce shown is of, with whether it can have one: a new row,
   * or the same one become public and final, starts over, and an answer for
   * a row shown before is dropped.
   */
  let nonceOf = "";

  /** @type {string | null} */
  let nonce = null;

  /**
   * @param {string} hash
   * @param {boolean} canHaveOne Whether the row is public and final
   */
  async function showNonce(hash, canHaveOne) {
    const key = `${hash} ${canHaveOne}`;

    nonceOf = key;
    nonce = null;

    if (!canHaveOne) {
      return;
    }

    const found = await loadNonce(hash).catch(() => null);

    if (nonceOf === key) {
      nonce = found;
    }
  }

  /** @param {string} value */
  const lux = (value) => {
    try {
      return BigInt(value);
    } catch {
      return 0n;
    }
  };

  $: p = presentation;
  $: time = rowTime(row);
  $: outcome =
    p.status === "failed"
      ? { icon: mdiAlertCircleOutline, text: "Failed · nothing sent" }
      : p.status === "pending"
        ? { icon: mdiTimerSand, text: "Pending" }
        : p.status === "unknown"
          ? { icon: mdiTimerSand, text: "Not confirmed by the network" }
          : p.withdrawal
            ? p.withdrawal.claimed
              ? { icon: mdiCheck, text: "Proved · claimed" }
              : { icon: mdiTimerSand, text: "Proved · not claimed yet" }
            : row.success === true || row.status === "executed"
              ? { icon: mdiCheck, text: "Completed" }
              : { icon: mdiTimerSand, text: "Checking the outcome…" };
  $: headline =
    p.titleIsAddress || p.icon === "sent" || p.icon === "received"
      ? `${row.direction === "in" ? "Received from" : "Sent to"} ${p.title}`
      : p.title;
  $: counterpartyLabel = row.direction === "in" ? "From" : "To";
  $: duskName = row.counterpartyName ?? row.toName;
  $: contact =
    $contactsStore.find((saved) => saved.address === p.counterparty) ?? null;
  $: canSave =
    !contact &&
    Boolean(p.counterparty) &&
    addressType(String(p.counterparty)) !== "unknown";
  $: canSendAgain =
    p.icon === "sent" && !!p.counterparty && row.kind === "transfer";
  $: hasNonce = row.privacy !== "shielded" && row.source !== "local";
  $: if (`${row.hash} ${hasNonce}` !== nonceOf) {
    showNonce(row.hash, hasNonce);
  }
  $: known = p.counterparty ? contractLabel(p.counterparty, network) : "";
  $: isSent = row.direction !== "in" && p.icon !== "received";
  $: gasUsed =
    row.gasSpent && row.gasLimit
      ? `${Number(row.gasSpent).toLocaleString(locale)} of ${Number(row.gasLimit).toLocaleString(locale)}`
      : "";

  onMount(() => {
    closeButton?.focus();
  });
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<aside
  aria-labelledby="tx-detail-title"
  class="tx-detail"
  on:keydown={(event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      dispatch("close");
    }
  }}
>
  <header class="tx-detail__header">
    <h2 id="tx-detail-title">Transaction</h2>
    <button
      aria-label="Close the details"
      bind:this={closeButton}
      class="tx-detail__close"
      on:click={() => dispatch("close")}
      type="button"
    >
      <Icon path={mdiClose} />
    </button>
  </header>

  <div class="tx-detail__body">
    <div class="tx-detail__summary">
      <span aria-hidden="true" class="tx-detail__icon"
        ><Icon path={ACTIVITY_ICONS[p.icon]} /></span
      >
      <div>
        <p class="tx-detail__headline">{headline}</p>
        <p class="tx-detail__outcome tx-detail__outcome--{p.status ?? 'final'}">
          <Icon path={outcome.icon} />{outcome.text}
        </p>
      </div>
    </div>

    <p
      class="tx-detail__amount"
      class:tx-detail__amount--muted={p.amount.muted}
    >
      {p.amount.sign}<BalanceValue value={p.amount.exact} />
      <span class="tx-detail__unit">DUSK</span>
    </p>

    <dl class="tx-detail__list">
      <div>
        <dt>Date</dt>
        <dd>{time === null ? "Not known yet" : fullDateTime(time, locale)}</dd>
      </div>
      {#if p.counterparty && p.icon !== "shield"}
        <div class="tx-detail__wide">
          <dt>{counterpartyLabel}</dt>
          <dd>
            {#if row.bridge?.kind === "deposit"}
              <span class="tx-detail__name">DuskEVM address</span>
            {:else if known}
              <span class="tx-detail__name">{known}</span>
            {:else if contact || duskName}
              <span class="tx-detail__name"
                >{contact && duskName
                  ? `${contact.name} · ${duskName}`
                  : (contact?.name ?? duskName)}</span
              >
            {/if}
            <span class="tx-detail__code"
              >{#each [parts(p.counterparty)] as [head, middle, tail] (tail)}<b
                  >{head}</b
                ><span class="tx-detail__middle">{middle}</span><b
                  class="tx-detail__tail">{tail}</b
                >{/each}</span
            >
            <button
              class="tx-detail__copy"
              on:click={() => copy(String(p.counterparty), "address")}
              type="button"><Icon path={mdiContentCopy} />Copy</button
            >
            {#if canSave && !isSavingContact}
              <Button
                className="tx-detail__save"
                on:click={() => {
                  isSavingContact = true;
                }}
                size="small"
                text="Save to contacts"
                variant="tertiary"
              />
            {:else if isSavingContact}
              <form
                class="tx-detail__save-form"
                on:submit|preventDefault={saveCounterparty}
              >
                <label for="tx-detail-contact-name">Contact name</label>
                <div class="tx-detail__save-row">
                  <Textbox
                    bind:value={contactName}
                    id="tx-detail-contact-name"
                    maxlength={40}
                    type="text"
                  />
                  <Button
                    on:click={() => {
                      isSavingContact = false;
                    }}
                    size="small"
                    text="Cancel"
                    variant="secondary"
                  />
                  <Button
                    disabled={!contactName.trim()}
                    size="small"
                    text="Save"
                    type="submit"
                    variant="primary"
                  />
                </div>
                <p class="tx-detail__note">Saved only on this device.</p>
              </form>
            {/if}
          </dd>
        </div>
      {/if}
      {#if p.withdrawal && !p.withdrawal.claimed}
        <div class="tx-detail__wide">
          <dt>Next step</dt>
          <dd>
            {p.withdrawal.ready
              ? "Claim it on Dusk: it's ready."
              : `Claim it on Dusk from about ${fullDateTime(p.withdrawal.claimFrom, locale)}.`}
            <AnchorButton
              className="tx-detail__next"
              href={addBasePath(
                "/dashboard/bridge/transactions?view=withdrawals"
              )}
              size="small"
              text="Open withdrawals"
              variant="secondary"
            />
          </dd>
        </div>
      {/if}
      {#if account && isSent}
        <div class="tx-detail__wide">
          <dt>From</dt>
          <dd>
            <span class="tx-detail__name"
              >{account.label}, {p.privacy === "Shielded"
                ? "shielded balance"
                : "public balance"}</span
            >
            {#if p.privacy !== "Shielded"}
              <span class="tx-detail__code"
                >{#each [parts(account.address)] as [head, middle, tail] (tail)}<b
                    >{head}</b
                  ><span class="tx-detail__middle">{middle}</span><b
                    class="tx-detail__tail">{tail}</b
                  >{/each}</span
              >
            {/if}
          </dd>
        </div>
      {/if}
      <div>
        <dt>Type</dt>
        <dd>{p.privacy}</dd>
      </div>
      {#if row.memo}
        <div>
          <dt>Memo</dt>
          <dd class="tx-detail__memo">{row.memo}</dd>
        </div>
      {/if}
      <div>
        <dt>Network fee paid</dt>
        <dd>
          {row.feePaid
            ? `${formatDuskExact(lux(row.feePaid), locale)} DUSK`
            : p.icon === "received"
              ? "Paid by the sender"
              : "Not known yet"}
        </dd>
      </div>
      <div class="tx-detail__wide">
        <dt>Transaction ID</dt>
        <dd class="tx-detail__id">
          <span class="tx-detail__code"
            >{#each [parts(row.hash)] as [head, middle, tail] (tail)}<b
                >{head}</b
              ><span class="tx-detail__middle">{middle}</span><b
                class="tx-detail__tail">{tail}</b
              >{/each}</span
          >
          <button
            class="tx-detail__copy"
            on:click={() => copy(row.hash)}
            type="button"><Icon path={mdiContentCopy} />Copy</button
          >
        </dd>
      </div>
    </dl>

    <details class="tx-detail__tech">
      <summary>Technical details</summary>
      <dl class="tx-detail__list tx-detail__list--tech">
        <div>
          <dt>Block height</dt>
          <dd>
            {#if row.blockHeight === undefined}
              Not in a block yet
            {:else if row.blockHash}
              <a
                href={`/explorer/blocks/block?id=${row.blockHash}`}
                rel="noopener noreferrer"
                target="_blank"
                >{row.blockHeight.toLocaleString(locale)}<span class="sr-only">
                  (opens the block in the Dusk explorer)</span
                ></a
              >
            {:else}
              {row.blockHeight.toLocaleString(locale)}
            {/if}
          </dd>
        </div>
        {#if gasUsed}
          <div>
            <dt>Gas used</dt>
            <dd>{gasUsed}</dd>
          </div>
        {/if}
        {#if row.gasPrice}
          <div>
            <dt>Gas price</dt>
            <dd>{Number(row.gasPrice).toLocaleString(locale)} LUX</dd>
          </div>
        {/if}
        {#if nonce !== null}
          <div>
            <dt>Nonce</dt>
            <dd>{nonce}</dd>
          </div>
        {/if}
        <div>
          <dt>Finality</dt>
          <dd>
            {row.source === "local" ? "Not final yet" : "Final"}
          </dd>
        </div>
        {#if row.error}
          <div class="tx-detail__wide">
            <dt>Error</dt>
            <dd class="tx-detail__error">{row.error}</dd>
          </div>
        {/if}
      </dl>
    </details>

    <div class="tx-detail__actions">
      <AnchorButton
        href={`/explorer/transactions/transaction?id=${row.hash}`}
        icon={{ path: mdiOpenInNew, position: "after" }}
        rel="noopener noreferrer"
        target="_blank"
        text="View in Dusk explorer"
        variant="secondary"
      />
      {#if canSendAgain}
        <AnchorButton
          href={addBasePath(
            `/dashboard/send?to=${encodeURIComponent(String(p.counterparty))}`
          )}
          icon={{ path: mdiSendOutline }}
          text="Send again"
          variant="secondary"
        />
      {/if}
    </div>
  </div>
</aside>

<style lang="postcss">
  .tx-detail {
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--calm-panel);
  }

  .tx-detail__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 3.625rem;
    padding: 0 0.75rem 0 1.5rem;
    border-bottom: 1px solid var(--calm-line);

    & h2 {
      font-size: 1.0625rem;
      font-weight: 500;
    }
  }

  .tx-detail__close {
    all: unset;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    color: var(--calm-muted);
    cursor: pointer;

    &:hover {
      color: var(--calm-text);
    }

    &:focus-visible {
      outline: 2px solid var(--calm-focus);
    }
  }

  .tx-detail__body {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.25rem 1.5rem 2rem;
  }

  .tx-detail__summary {
    display: flex;
    align-items: center;
    gap: 0.875rem;
  }

  .tx-detail__icon {
    display: grid;
    place-items: center;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 50%;
    background: var(--calm-s2);
    flex: 0 0 auto;
  }

  .tx-detail__headline {
    font-size: 1rem;
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  .tx-detail__outcome {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.125rem;
    color: var(--calm-muted);
    font-size: 0.84375rem;

    & :global(.dusk-icon) {
      width: 0.9375rem;
      height: 0.9375rem;
    }

    &--failed {
      color: var(--calm-danger);
    }

    &--pending {
      color: var(--calm-pending);
    }
  }

  .tx-detail__amount {
    font-size: 2.5rem;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;

    &--muted {
      color: var(--calm-subtle);
    }
  }

  .tx-detail__unit {
    color: var(--calm-muted);
    font-size: 1rem;
  }

  .tx-detail__list {
    display: flex;
    flex-direction: column;
    margin: 0;

    & > div {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.625rem 0;
      border-top: 1px solid var(--calm-line);
      font-size: 0.875rem;
    }

    & dt {
      color: var(--calm-muted);
      white-space: nowrap;
    }

    & dd {
      margin: 0;
      text-align: right;
      font-variant-numeric: tabular-nums;
      min-width: 0;
    }

    & > .tx-detail__wide {
      flex-direction: column;
      gap: 0.375rem;

      & dd {
        text-align: left;
      }
    }
  }

  .tx-detail__name {
    display: block;
    font-weight: 500;
  }

  .tx-detail__list :global(.tx-detail__save) {
    align-self: flex-start;
    margin-top: 0.375rem;
  }

  .tx-detail__save-form {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    margin-top: 0.5rem;

    & label {
      color: var(--calm-muted);
      font-size: 0.8125rem;
    }
  }

  .tx-detail__save-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;

    & > :global(input) {
      flex: 1 1 8rem;
      min-width: 0;
    }
  }

  .tx-detail__note {
    color: var(--calm-muted);
    font-size: 0.78125rem;
  }

  .tx-detail__code {
    font-family: var(--code-font-family);
    font-size: 0.78125rem;
    line-height: 1.6;
    color: var(--calm-muted);

    & b {
      color: var(--calm-text);
      font-weight: 500;
    }
  }

  .tx-detail__middle {
    word-break: break-all;
  }

  /* The ending compared against an invoice stays on one line. */
  .tx-detail__tail {
    white-space: nowrap;
  }

  .tx-detail__id {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .tx-detail__list a {
    color: inherit;
    text-underline-offset: 2px;
  }

  .tx-detail__copy {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: 0.3125rem;
    flex: 0 0 auto;
    min-height: 2rem;
    padding: 0 0.75rem;
    border-radius: 999px;
    background: var(--calm-s2);
    font-size: 0.78125rem;
    font-weight: 500;
    cursor: pointer;

    & :global(.dusk-icon) {
      width: 0.8125rem;
      height: 0.8125rem;
    }

    &:focus-visible {
      outline: 2px solid var(--calm-focus);
    }
  }

  .tx-detail__memo {
    overflow-wrap: anywhere;
  }

  .tx-detail__error {
    color: var(--calm-muted);
    font-family: var(--code-font-family);
    font-size: 0.78125rem;
    overflow-wrap: anywhere;
  }

  .tx-detail__tech {
    border: 1px solid var(--calm-line);
    border-radius: 0.75rem;
    padding: 0 0.875rem;

    & summary {
      min-height: 44px;
      display: flex;
      align-items: center;
      font-size: 0.875rem;
      cursor: pointer;
    }

    & .tx-detail__list > div:first-child {
      border-top: 0 none;
    }
  }

  .tx-detail__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.625rem;

    & :global(.dusk-anchor-button) {
      flex: 1 1 auto;
    }
  }
</style>
