<script>
  /**
   * How a transfer just sent is getting on, for as long as this screen is
   * open: what Bridge › Activity knows of it, in words. It says what arrived,
   * that it's late, or that it failed, and until then what it says on sending.
   */
  import { onMount } from "svelte";

  import { currentActivity } from "$lib/activity";
  import { followRouteTransfers } from "$lib/bridge/routeFollowing";
  import { routeTransfers } from "$lib/bridge/routeHistory";
  import { settingsStore } from "$lib/stores";
  import { duskExplorerTx } from "$lib/url";

  import AppAnchorButton from "../AppAnchorButton/AppAnchorButton.svelte";
  import ArrivalNotice from "./ArrivalNotice.svelte";
  import { transferOutcome } from "../EvmTransactions/bridgeActivity";
  import WithdrawalHash from "../EvmTransactions/WithdrawalHash.svelte";

  /** The transaction sent. */
  /** @type {string} */
  export let hash;

  /** The screen's heading: given as it is on sending, and bound. */
  /** @type {string} */
  export let heading;

  /** Whether balances are hidden. */
  /** @type {boolean} */
  export let masked;

  /** @type {import("$lib/bridge/cardRoutes").CardRoute} */
  export let route;

  /** What it says until there's more to say. */
  /** @type {string} */
  export let sentText;

  /** @type {RouteTime | null} */
  export let time;

  const sentHeading = heading;

  let now = Date.now();

  onMount(() => {
    const stop = followRouteTransfers();
    // A payout into Dusk shows in the history: read sooner than the page does.
    const timer = setInterval(() => {
      now = Date.now();

      if (!outcome?.heading && document.visibilityState !== "hidden") {
        void currentActivity()?.refresh();
      }
    }, 15_000);

    return () => {
      stop();
      clearInterval(timer);
    };
  });

  // A wallet may answer with any capitals: what's kept is in lower case.
  $: transfer = $routeTransfers.find(
    (known) => known.hash.toLowerCase() === hash.toLowerCase()
  );
  $: outcome = transfer
    ? transferOutcome(transfer, {
        locale: $settingsStore.language,
        masked,
        now,
        time,
      })
    : null;
  $: heading = outcome?.heading ?? sentHeading;
  $: isMigration = route.kind === "migration";
</script>

<p>{outcome?.sentence ?? sentText}</p>
{#if !outcome?.heading}
  <ArrivalNotice />
{/if}
<WithdrawalHash
  explorerName={isMigration ? `${route.chain.name} explorer` : "Dusk explorer"}
  href={isMigration
    ? `${route.chain.explorerUrl}/tx/${hash}`
    : duskExplorerTx(hash)}
  name={isMigration
    ? `${route.chain.name} transaction hash`
    : "Dusk transaction hash"}
  value={hash}
/>
<AppAnchorButton
  href={`/dashboard/bridge/transactions?tx=${hash}`}
  text={outcome?.heading ? "View in activity" : "Track in activity"}
  variant="tertiary"
/>
