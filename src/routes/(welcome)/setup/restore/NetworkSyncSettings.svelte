<svelte:options immutable={true} />

<script>
  import { mdiCubeOutline } from "@mdi/js";

  import { Card, Textbox } from "$lib/dusk/components";
  import { createNumberFormatter } from "$lib/dusk/number";
  import { makeClassName } from "$lib/dusk/string";

  import { Banner } from "$lib/components";
  import { ToggleableCard } from "$lib/containers/Cards";

  import { networkStore, settingsStore } from "$lib/stores";

  /**
   * The block the wallet syncs from: the one typed while the switch is on,
   * else the first.
   *
   * @type {bigint}
   */
  export let blockHeight = 0n;

  /** @type {boolean} */
  export let isValid = false;

  /** @type {boolean} */
  export let isToggled = false;

  /** @type {bigint} */
  let currentNetworkBlock;

  /** @type {boolean} */
  let errorFetchingCurrentNetworkBlock;

  /**
   * The block as typed: empty each time the switch goes on, as no block
   * suits every wallet.
   */
  let typed = "";

  const { language } = $settingsStore;
  const numberFormatter = createNumberFormatter(language);

  const clearTyped = () => {
    typed = "";
  };

  networkStore
    .getCurrentBlockHeight()
    .then((block) => {
      currentNetworkBlock = block;
    })
    .catch(() => {
      errorFetchingCurrentNetworkBlock = true;
    });

  $: typedHeight = /^\d+$/.test(typed.trim()) ? BigInt(typed.trim()) : null;

  $: blockHeight = isToggled && typedHeight !== null ? typedHeight : 0n;

  // On, it takes a block up to the network's latest, and none while empty.
  $: isValid =
    !isToggled ||
    (typedHeight !== null &&
      currentNetworkBlock !== undefined &&
      typedHeight <= currentNetworkBlock);

  $: isWrong = typed.trim() !== "" && !isValid;
</script>

<!-- As on a new wallet: the block it starts at is for experts, under
  Advanced, open while one is chosen. -->
<Card>
  <p>Finds your balance and past payments.</p>

  <details class="network-sync__advanced" open={isToggled}>
    <summary>Advanced</summary>
    <div class="network-sync__advanced-content">
      <ToggleableCard
        bind:isToggled
        iconPath={mdiCubeOutline}
        heading="Start from block"
        onSurface
        on:toggle={clearTyped}
      >
        <Textbox
          aria-describedby="block-height-hint"
          aria-invalid={isWrong}
          aria-label="Start from block"
          autocomplete="off"
          bind:value={typed}
          className={makeClassName({
            "block-height-input": true,
            "block-height-input--invalid": isWrong,
          })}
          inputmode="numeric"
          type="text"
        />

        <span class="block-height-meta" id="block-height-hint"
          >Your wallet's first block, or earlier. Too late hides payments. Not
          sure? Leave it off.</span
        >

        {#if currentNetworkBlock}
          <span class="block-height-meta"
            >Network is at {numberFormatter(currentNetworkBlock)}</span
          >
        {/if}

        {#if errorFetchingCurrentNetworkBlock}
          <Banner
            title="Couldn't read the network's latest block."
            variant="error"
          />
        {/if}
      </ToggleableCard>
    </div>
  </details>
</Card>

<style lang="postcss">
  .network-sync__advanced {
    & summary {
      padding: 0.6875em 0;
      cursor: pointer;
      font-weight: 500;
    }

    &-content {
      display: flex;
      flex-direction: column;
      gap: var(--small-gap);
    }
  }

  :global {
    /* Under the field, as the wallet's hints are. */
    .block-height-meta {
      color: var(--calm-muted);
      font-size: 0.84375rem;
    }

    .block-height-input--invalid {
      color: var(--error-color);
    }
  }
</style>
