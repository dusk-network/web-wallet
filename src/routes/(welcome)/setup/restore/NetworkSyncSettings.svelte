<svelte:options immutable={true} />

<script>
  import { mdiCubeOutline } from "@mdi/js";

  import { Textbox } from "$lib/dusk/components";
  import { createNumberFormatter } from "$lib/dusk/number";
  import { makeClassName } from "$lib/dusk/string";

  import { AppAnchor, Banner } from "$lib/components";
  import { DOCUMENTATION_LINKS } from "$lib/constants";
  import { IconHeadingCard, ToggleableCard } from "$lib/containers/Cards";

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
<IconHeadingCard icons={[mdiCubeOutline]} heading="Ready to sync">
  <p>Next, the wallet syncs with the network.</p>

  <details class="network-sync__advanced" open={isToggled}>
    <summary>Advanced</summary>
    <div class="network-sync__advanced-content">
      <ToggleableCard
        bind:isToggled
        iconPath={mdiCubeOutline}
        heading="Block height"
        onSurface
        on:toggle={clearTyped}
      >
        <Textbox
          aria-describedby="block-height-hint"
          aria-invalid={isWrong}
          aria-label="Block height"
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
          >The block your wallet was made at, or earlier. Not sure? Leave this
          off.</span
        >

        {#if currentNetworkBlock}
          <span class="block-height-meta"
            >Network block height: {numberFormatter(currentNetworkBlock)}</span
          >
        {/if}

        {#if errorFetchingCurrentNetworkBlock}
          <Banner
            title="Unable to fetch current network block height."
            variant="error"
          >
            <p>Please try again later.</p>
          </Banner>
        {/if}
      </ToggleableCard>

      <Banner title="Syncing from a later block is faster." variant="info">
        <p>
          A wrong block can lead to a wrong balance or missing transactions.
          Find out more in our <AppAnchor
            className="text-link"
            href={DOCUMENTATION_LINKS.RESTORE_BLOCK_HEIGHT}
            rel="noopener noreferrer"
            target="_blank">documentation</AppAnchor
          >.
        </p>
      </Banner>
    </div>
  </details>
</IconHeadingCard>

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
