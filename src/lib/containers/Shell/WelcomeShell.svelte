<script>
  import { networkStore } from "$lib/stores";

  import TestnetStrip from "./TestnetStrip.svelte";
  import TopBar from "./TopBar.svelte";
  import keyboardInset from "./keyboardInset";
  import { isTestNetwork } from "./navigation";

  /**
   * The screens before a wallet opens, as the wallet itself: its top bar
   * with the brand alone, and on a test network its strip, over a column
   * as wide as Settings', on the wallet's page. A flow's buttons stay in
   * view as the wallet's do, above a phone's keyboard.
   */

  $: ({ networkName } = $networkStore);
</script>

<div
  class="welcome-shell"
  class:welcome-shell--test={isTestNetwork(networkName)}
  use:keyboardInset
>
  <div class="welcome-shell__header">
    <TestnetStrip />
    <TopBar activeTab={null} bare tabs={[]} />
  </div>
  <div class="welcome-shell__content">
    <slot />
  </div>
</div>

<style lang="postcss">
  .welcome-shell {
    --top-bar-height: 3.75rem;

    display: flex;
    flex-direction: column;
    min-height: 100vh;
    min-height: 100dvh;
    background: var(--calm-s0);
    color: var(--calm-text);
  }

  .welcome-shell__header {
    position: sticky;
    top: 0;
    z-index: 12;
  }

  /* As Settings' and Add wallet's. */
  .welcome-shell__content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    width: min(100%, 44rem);
    margin: 0 auto;
    padding: 2rem 1.5rem 3rem;
  }

  /* A screen's title, as the wallet's pages have theirs. */
  .welcome-shell__content :global(.h1) {
    font-size: 1.75rem;
    font-weight: 500;
    letter-spacing: -0.01em;
    line-height: 1.15;
  }

  @media (max-width: 47.99rem) {
    .welcome-shell__content {
      padding: 1rem 1rem 2rem;
    }

    .welcome-shell__content :global(.h1) {
      font-size: 1.375rem;
    }
  }
</style>
