<svelte:options immutable={true} />

<script>
  import { AppAnchor, CopyField } from "$lib/components";
  import { DOCUMENTATION_LINKS } from "$lib/constants";
  import { IconHeadingCard } from "$lib/containers/Cards";
  import { createNumberFormatter } from "$lib/dusk/number";
  import { settingsStore } from "$lib/stores";
  import { mdiCubeOutline } from "@mdi/js";
  $: ({ language } = $settingsStore);

  /** @type {bigint} */
  export let currentBlockHeight;

  const numberFormatter = createNumberFormatter(language);
</script>

<IconHeadingCard icons={[mdiCubeOutline]} heading="Ready to sync">
  <p>Next, the wallet syncs with the network. There is nothing to note.</p>

  <!-- For experts: where the wallet starts, which Settings keeps too. -->
  <details class="network-sync__advanced">
    <summary>Advanced</summary>
    <div class="network-sync__advanced-content">
      <p>
        The wallet starts at this block. Restoring it from here syncs faster.
        Settings shows it too, under Advanced.
      </p>
      <CopyField
        name="Block Height"
        displayValue={numberFormatter(currentBlockHeight)}
        rawValue={String(currentBlockHeight)}
      />
      <small>
        Find out more in our <AppAnchor
          className="text-link"
          href={DOCUMENTATION_LINKS.RESTORE_BLOCK_HEIGHT}
          rel="noopener noreferrer"
          target="_blank">documentation</AppAnchor
        >.
      </small>
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
</style>
