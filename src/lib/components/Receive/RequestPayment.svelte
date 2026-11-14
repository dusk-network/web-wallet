<svelte:options immutable={true} />

<script>
  /**
   * Request payment, folded under Receive: an amount and a memo, checked as
   * they're typed, as Send will check them. Once there's either, the QR holds
   * the request, and its link can be copied: a link for a payer on any wallet,
   * which opens the web wallet's Send, filled in.
   */
  import { mdiChevronDown } from "@mdi/js";
  import { readAmount } from "@dusk-network/app-core/amounts";
  import { displayText, numbersNote } from "@dusk-network/app-core/text";

  import { CopyButton, Icon, Textbox } from "$lib/dusk/components";
  import { formatDusk } from "$lib/dusk/currency";
  import { randomUUID } from "$lib/dusk/string";
  import { formDraft } from "$lib/navigation";
  import { makeRequestLink, requestText } from "$lib/payment-requests";
  import { settingsStore } from "$lib/stores";
  import nodeNetwork from "$lib/stores/nodeNetwork";

  import AmountInCurrency from "../AmountInCurrency/AmountInCurrency.svelte";
  import AmountQuestion from "../AmountQuestion/AmountQuestion.svelte";
  import MemoText from "../MemoText/MemoText.svelte";

  /** The account or shielded address that's paid. */
  /** @type {string} */
  export let address;

  /**
   * What's asked, once there's something and it can be paid: the links, what's
   * in them, and null until then.
   *
   * @type {{ dusk: string, link: string, lux: bigint | null, memo: string } | null}
   */
  export let request = null;

  /** Called as the request leaves the wallet. */
  /** @type {() => void} */
  export let onUse = () => {};

  /**
   * Whose request it is, as Copy says it: the profile's verified .dusk name,
   * else the name given it here, "" for none.
   */
  export let requestName = "";

  const id = randomUUID();
  const draft = formDraft("request");

  /** What was typed before a lock or a reload. */
  /** @type {any} */
  const typedBefore = draft.read();

  let amount = typedBefore?.amount ?? "";
  let memo = typedBefore?.memo ?? "";
  let isOpen = Boolean(amount || memo);

  $: ({ language } = $settingsStore);
  $: made = makeRequestLink(
    { amount, language, memo, to: address },
    $nodeNetwork
  );
  $: memoAsked = memo.trim();
  $: request =
    isOpen && made.ok && (made.lux !== null || memoAsked)
      ? {
          dusk: made.dusk,
          link: made.https ?? made.dusk,
          lux: made.lux,
          memo: memoAsked,
        }
      : null;
  $: draft.save({ amount, memo });
  // What the field may not show as it is, as a payer's wallet shows it: a
  // hidden character, as one that turns the text around, or a number that
  // can read as another.
  $: memoShown = displayText(memo);
  $: isMemoFlagged =
    memoShown.neutralized || numbersNote(memoShown.flags) !== "";
</script>

<details bind:open={isOpen} class="request">
  <summary class="request__summary">
    <span>Request payment</span>
    {#if request}
      <span class="request__meta"
        >{request.lux === null
          ? "With memo"
          : `${formatDusk(request.lux, language)} DUSK`}</span
      >
    {/if}
    <Icon className="request__chevron section-chevron" path={mdiChevronDown} />
  </summary>
  <div class="request__body">
    <div class="request__field">
      <label for="{id}-amount">Amount (optional)</label>
      <div class="request__amount">
        <Textbox
          aria-describedby={made.problems.amount
            ? `${id}-amount-error`
            : undefined}
          aria-invalid={made.problems.amount ? "true" : undefined}
          autocomplete="off"
          bind:value={amount}
          id="{id}-amount"
          inputmode="decimal"
          placeholder="0"
          type="text"
        />
        <span aria-hidden="true" class="request__unit">DUSK</span>
      </div>
      {#if readAmount(amount, language).question}
        <!-- Either of two: a tap on one puts it in the field. -->
        <AmountQuestion
          className="request__error"
          id="{id}-amount-error"
          {language}
          on:choose={(event) => {
            amount = event.detail;
          }}
          text={amount}
        />
      {:else if made.problems.amount}
        <p class="request__error" id="{id}-amount-error" role="alert">
          {made.problems.amount}
        </p>
      {:else}
        <!-- What it comes to in the person's money: the link asks DUSK. -->
        <AmountInCurrency className="request__in-currency" lux={made.lux} />
      {/if}
    </div>
    <div class="request__field">
      <label for="{id}-memo">Memo (optional)</label>
      <Textbox
        aria-describedby={made.problems.memo ? `${id}-memo-error` : undefined}
        aria-invalid={made.problems.memo ? "true" : undefined}
        autocomplete="off"
        bind:value={memo}
        id="{id}-memo"
        type="text"
      />
      {#if made.problems.memo}
        <p class="request__error" id="{id}-memo-error" role="alert">
          {made.problems.memo}
        </p>
      {:else if isMemoFlagged}
        <p class="request__flag" role="status">
          <MemoText text={memo} />
        </p>
      {/if}
    </div>
    {#if made.problems.to}
      <p class="request__error" role="alert">{made.problems.to}</p>
    {/if}
    {#if request}
      <p class="request__note">
        The QR holds what you ask for.{request.link === request.dusk
          ? ""
          : " The link opens the web wallet's Send, filled in."}
      </p>
      <!-- What it asks in a line, then its link. -->
      <CopyButton
        className="request__copy"
        name="request link"
        onCopied={onUse}
        text="Copy request link"
        value={requestText(request, {
          language,
          name: requestName,
          net: $nodeNetwork,
        })}
        variant="secondary"
      />
    {/if}
  </div>
</details>

<style lang="postcss">
  .request {
    width: 100%;
    border-top: 1px solid var(--calm-line);
  }

  .request__summary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 44px;
    color: var(--calm-text);
    font-size: 0.875rem;
    cursor: pointer;
    list-style: none;

    &::-webkit-details-marker {
      display: none;
    }

    &:focus-visible {
      outline: 2px solid var(--calm-focus);
      outline-offset: 2px;
    }

    :global(.request__chevron) {
      margin-left: auto;
      transition: transform 0.2s ease;
    }
  }

  .request[open] :global(.request__chevron) {
    transform: rotate(180deg);
  }

  .request__meta {
    color: var(--calm-muted);
  }

  .request__body {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    padding-bottom: 0.75rem;

    :global(.request__copy) {
      width: 100%;
    }
  }

  .request__flag {
    font-size: 0.875rem;
    overflow-wrap: anywhere;
  }

  .request__field {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;

    & label {
      color: var(--calm-muted);
      font-size: 0.875rem;
    }

    & :global(.dusk-textbox) {
      width: 100%;
    }
  }

  .request__amount {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .request__unit {
    color: var(--calm-muted);
    font-size: 0.875rem;
  }

  .request__note {
    color: var(--calm-muted);
    font-size: 0.84375rem;
    line-height: 1.45;
  }

  .request__error {
    color: var(--calm-danger);
    font-size: 0.875rem;
  }

  .request :global(.request__in-currency) {
    color: var(--calm-muted);
    font-size: 0.875rem;
  }
</style>
