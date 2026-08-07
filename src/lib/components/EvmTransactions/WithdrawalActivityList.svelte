<script>
  import { createEventDispatcher } from "svelte";
  import { mdiChevronDown, mdiContain, mdiWalletOutline } from "@mdi/js";

  import {
    withdrawalStageBadge,
    withdrawalStageLabel,
  } from "$lib/bridge/withdrawalLifecycle";
  import { isWithdrawalTxHash } from "$lib/bridge/withdrawals";
  import { Badge, Button, Icon, Textbox, Throbber } from "$lib/dusk/components";
  import { modal } from "$lib/web3/walletConnection";

  import Banner from "../Banner/Banner.svelte";
  import WithdrawalLifecycle from "./WithdrawalLifecycle.svelte";
  import {
    activityAmount,
    formatTimestamp,
    shortened,
  } from "./withdrawalPresentation";

  const dispatch = createEventDispatcher();

  /** @type {any[]} */
  export let activity;

  /** @type {string} */
  export let activityError;

  /** @type {boolean} */
  export let canCheck;

  /** @type {string | null} */
  export let currentAccount;

  /** @type {string} */
  export let hashError;

  /** @type {boolean} */
  export let isActivityLoading;

  /** @type {boolean} */
  export let isChecking;

  /** @type {boolean} */
  export let isSubmitting;

  /** @type {Date | null} */
  export let lastCheckedAt;

  /** @type {string | null} */
  export let selectedTransactionHash;

  /** @type {any} */
  export let selectedWithdrawal;

  /** @type {string} */
  export let statusError;

  /** @type {string} */
  export let submittedHash;

  /** @type {string} */
  export let txHash;

  function validateHashInput() {
    hashError =
      txHash.length > 0 && !isWithdrawalTxHash(txHash.trim())
        ? "Enter a 0x-prefixed 32-byte transaction hash."
        : "";
  }
</script>

<section class="activity-pane" aria-labelledby="recent-withdrawals-title">
  <header class="pane-header">
    <div>
      <h4 id="recent-withdrawals-title">Recent withdrawals</h4>
      {#if lastCheckedAt}
        <p>Updated {formatTimestamp(lastCheckedAt.toISOString())}</p>
      {/if}
    </div>
  </header>

  {#if !currentAccount}
    <Banner title="Connect DuskEVM wallet" variant="info">
      <div class="connect-wallet">
        <p>Connect the originating account to load its activity.</p>
        <Button
          icon={{ path: mdiWalletOutline }}
          text="Connect"
          on:click={() => modal.open()}
        />
      </div>
    </Banner>
  {:else if activityError}
    <Banner title="Explorer unavailable" variant="warning">
      <p>{activityError} Locally remembered withdrawals are still shown.</p>
    </Banner>
  {/if}

  {#if isActivityLoading && activity.length === 0}
    <div class="transactions-list__empty" aria-live="polite">
      <Throbber />
      <p>Loading activity</p>
    </div>
  {:else if activity.length > 0}
    <ul class="activity-list">
      {#each activity as item (item.transactionHash)}
        <li
          class:activity-list__entry--expanded={selectedTransactionHash ===
            item.transactionHash}
          class="activity-list__entry"
        >
          <button
            aria-controls={selectedTransactionHash === item.transactionHash
              ? `withdrawal-status-${item.transactionHash}`
              : undefined}
            aria-expanded={selectedTransactionHash === item.transactionHash}
            class:activity-list__item--selected={selectedTransactionHash ===
              item.transactionHash}
            class="activity-list__item"
            on:click={() => dispatch("select", item)}
            type="button"
          >
            <span class="activity-list__primary">
              <strong>{activityAmount(item) ?? "DUSK withdrawal"}</strong>
              <span>{formatTimestamp(item.timestamp)}</span>
            </span>
            <span class="activity-list__status">
              <span class="activity-list__status-summary">
                <Badge
                  text={withdrawalStageLabel(item.stage)}
                  variant={withdrawalStageBadge(item.stage)}
                />
                <span class="activity-list__chevron">
                  <Icon path={mdiChevronDown} size="small" />
                </span>
              </span>
              <span>{shortened(item.transactionHash)}</span>
            </span>
          </button>
          {#if selectedTransactionHash === item.transactionHash}
            <div
              class="activity-list__details"
              id={`withdrawal-status-${item.transactionHash}`}
            >
              <WithdrawalLifecycle
                {isChecking}
                {isSubmitting}
                {selectedWithdrawal}
                {statusError}
                {submittedHash}
                on:finalize={() => dispatch("finalize")}
                on:prove={() => dispatch("prove")}
              />
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <div class="transactions-list__empty">
      <Icon path={mdiContain} size="large" />
      <p>No withdrawals found</p>
    </div>
  {/if}

  <form
    class="withdrawal-lookup"
    on:submit|preventDefault={() => dispatch("check", txHash)}
  >
    <label for="withdrawal-tx-hash">Find by transaction hash</label>
    <div class="withdrawal-lookup__controls">
      <Textbox
        aria-describedby={hashError ? "withdrawal-tx-hash-error" : undefined}
        aria-invalid={hashError ? "true" : undefined}
        id="withdrawal-tx-hash"
        name="withdrawal-tx-hash"
        placeholder="0x..."
        bind:value={txHash}
        on:blur={validateHashInput}
        on:input={() => {
          if (isWithdrawalTxHash(txHash.trim())) hashError = "";
        }}
      />
      <Button
        disabled={!canCheck}
        text={isChecking ? "Checking" : "Check"}
        type="submit"
        variant="primary"
      />
    </div>
    {#if hashError}
      <p id="withdrawal-tx-hash-error" class="field-error" role="alert">
        {hashError}
      </p>
    {/if}
  </form>
</section>

<style lang="postcss">
  .activity-pane {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
    padding: 1.25rem;
  }

  .pane-header {
    align-items: flex-start;
    display: flex;
    gap: 1rem;
    justify-content: space-between;

    & h4,
    & p {
      margin: 0;
    }

    & p {
      color: var(--secondary-text-color);
      font-size: 0.8125rem;
      margin-top: 0.25rem;
    }
  }

  .connect-wallet {
    align-items: flex-start;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;

    & p {
      margin: 0;
    }
  }

  .activity-list {
    display: flex;
    flex-direction: column;
    list-style: none;
    margin: 0;
    padding: 0;

    & li + li {
      border-top: 1px solid var(--surface-border-color-subtle);
    }

    &__entry--expanded {
      background: var(--surface-hover-color);
    }

    &__item {
      align-items: center;
      background: transparent;
      border: 0;
      color: inherit;
      cursor: pointer;
      display: grid;
      font: inherit;
      gap: 0.75rem;
      grid-template-columns: minmax(0, 1fr) auto;
      min-height: 5.25rem;
      padding: 0.875rem 0.5rem;
      text-align: left;
      width: 100%;

      &:hover,
      &:focus-visible,
      &--selected {
        background: var(--surface-hover-color);
        outline: none;
      }

      &:focus-visible {
        box-shadow: inset 0 0 0 2px var(--secondary-color);
      }
    }

    &__primary,
    &__status {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      min-width: 0;
    }

    &__primary span,
    &__status > span:last-child {
      color: var(--secondary-text-color);
      font-size: 0.75rem;
    }

    &__status {
      align-items: flex-end;
      font-family: var(--mono-font-family);
      text-align: right;
    }

    &__status-summary {
      align-items: center;
      display: flex;
      gap: 0.5rem;
    }

    &__chevron {
      display: inline-flex;
      transition: transform 150ms ease;
    }

    &__entry--expanded &__chevron {
      transform: rotate(180deg);
    }

    &__details {
      border-top: 1px solid var(--surface-border-color-subtle);
    }
  }

  .withdrawal-lookup {
    border-top: 1px solid var(--surface-border-color-subtle);
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    margin-top: auto;
    padding-top: 1rem;

    &__controls {
      display: grid;
      gap: 0.5rem;
      grid-template-columns: minmax(0, 1fr) auto;
    }
  }

  .field-error {
    color: var(--error-color);
    font-size: 0.8125rem;
    margin: 0;
  }

  .transactions-list__empty {
    align-items: center;
    color: var(--secondary-text-color);
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 3rem 1.5rem;
    text-align: center;
  }

  @media (max-width: 30rem) {
    .activity-pane {
      padding-left: 1rem;
      padding-right: 1rem;
    }

    .activity-list__item,
    .withdrawal-lookup__controls {
      grid-template-columns: minmax(0, 1fr);
    }

    .activity-list__status {
      align-items: flex-start;
      text-align: left;
    }
  }
</style>
