<script>
  /**
   * How a transfer just sent is getting on, for as long as this screen is
   * open: what Bridge › Activity knows of it, in words. It says what arrived,
   * that it's late, or that it failed, and until then what it says on sending.
   */
  import { onMount } from "svelte";

  import { followRouteTransfers } from "$lib/bridge/routeFollowing";
  import { routeTransfers } from "$lib/bridge/routeHistory";
  import { settingsStore } from "$lib/stores";

  import AppAnchorButton from "../AppAnchorButton/AppAnchorButton.svelte";
  import { transferOutcome } from "../EvmTransactions/bridgeActivity";

  /** The transaction sent. */
  /** @type {string} */
  export let hash;

  /** The screen's heading: given as it is on sending, and bound. */
  /** @type {string} */
  export let heading;

  /** Whether balances are hidden. */
  /** @type {boolean} */
  export let masked;

  /** What it says until there's more to say. */
  /** @type {string} */
  export let sentText;

  /** @type {RouteTime | null} */
  export let time;

  const sentHeading = heading;

  let now = Date.now();

  onMount(() => {
    const stop = followRouteTransfers();
    const timer = setInterval(() => {
      now = Date.now();
    }, 30_000);

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
</script>

<p>{outcome?.sentence ?? sentText}</p>
<AppAnchorButton
  href={`/dashboard/bridge/transactions?tx=${hash}`}
  text={outcome?.heading ? "View in activity" : "Track in activity"}
  variant="tertiary"
/>
