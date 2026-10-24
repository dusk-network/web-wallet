<svelte:options immutable={true} />

<script>
  import { logo } from "$lib/dusk/icons";
  import { Icon } from "$lib/dusk/components";

  /** @type {string} */
  export let label;

  /**
   * The formatted amount in DUSK.
   *
   * @type {string}
   */
  export let value;
</script>

<dl class="review-amount">
  <dt>{label}</dt>
  <dd class="review-amount__value">
    <span>{value}</span>
    <Icon
      className="review-amount__icon"
      data-tooltip-id="main-tooltip"
      data-tooltip-text="DUSK"
      path={logo}
    />
  </dd>
</dl>

<style lang="postcss">
  .review-amount {
    display: flex;
    flex-direction: column;
    gap: 0.625em;

    &__value {
      display: inline-flex;
      align-items: center;
      gap: var(--small-gap);
      font-family: var(--mono-font-family);
      font-weight: 500;
    }

    :global(&__icon) {
      width: 1em;
      height: 1em;
      flex-shrink: 0;
    }
  }
</style>
