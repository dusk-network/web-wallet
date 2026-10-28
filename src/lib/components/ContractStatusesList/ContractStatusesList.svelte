<svelte:options immutable={true} />

<script>
  import { BalanceValue, DuskIcon } from "$lib/components";

  /** @type {ContractStatus[]} */
  export let statuses;

  /** @type {(status: ContractStatus) => status is ContractStatus & { value: string }} */
  const hasValue = (status) => status.value !== null;
</script>

<div class="contract-statuses">
  <dl class="contract-statuses__list">
    {#each statuses.filter(hasValue) as status (status.label)}
      <dt class="contract-statuses__label">
        {status.label}
      </dt>
      <dd class="contract-statuses__value">
        <span><BalanceValue exact={status.exact} value={status.value} /></span>
        <DuskIcon className="contract-statuses__icon" />
      </dd>
    {/each}
  </dl>
  <slot />
</div>

<style lang="postcss">
  .contract-statuses {
    background-color: var(--surface-soft-color);
    border: 1px solid var(--surface-border-color);
    border-radius: var(--control-border-radius-size);
    padding: 0.75em;
    width: 100%;
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    gap: var(--small-gap);

    &__list {
      width: 100%;
      display: grid;
      grid-template-columns: minmax(7rem, max-content) minmax(0, 1fr);
      row-gap: 0.5rem;
    }

    &__label,
    &__value {
      min-width: 0;
      line-height: 1.5;
      padding-block: 0.25rem;
    }

    &__label {
      align-self: center;
      color: var(--muted-color);
      font-size: 0.875rem;
      padding-left: 0.5rem;
      padding-right: 0.75rem;
    }

    &__value {
      display: inline-flex;
      align-items: center;
      gap: var(--small-gap);
      font-variant-numeric: tabular-nums;
      font-size: 0.9375rem;
      font-weight: 500;
      justify-content: end;
      padding-left: 0.75rem;
      padding-right: 0.5rem;
      text-align: right;
    }

    :global(&__icon) {
      width: 1em;
      height: 1em;
      flex-shrink: 0;
    }
  }

  @media (max-width: 32rem) {
    .contract-statuses {
      padding: 0.625rem;

      &__list {
        grid-template-columns: 1fr;
        row-gap: 0.15rem;
      }

      &__label,
      &__value {
        padding-inline: 0;
      }

      &__value {
        justify-content: flex-start;
        text-align: left;
      }
    }
  }
</style>
