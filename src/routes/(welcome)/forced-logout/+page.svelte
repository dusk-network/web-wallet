<script>
  import { onMount } from "svelte";
  import { AppAnchorButton } from "$lib/components";
  import { WarningCard } from "$lib/containers/Cards";

  // What locked this tab: another one set up a wallet here, in place of
  // the ones here, or reset them, as the settings it changed say.
  const WHY =
    "Your DUSK is safe on the network. Another tab or window created, restored or reset a wallet in this browser, so this tab locked.";

  onMount(() => {
    alert(WHY);
  });
</script>

<section class="forced-logout">
  <WarningCard heading="You have been automatically logged out">
    <div>
      <p>{WHY}</p>
      <p>
        If your wallet is no longer here, restore it with its recovery phrase.
        It then syncs again in full.
      </p>
    </div>
  </WarningCard>
  <AppAnchorButton data-sveltekit-replacestate href="/" text="Home" />
</section>

<style>
  .forced-logout {
    display: flex;
    flex-direction: column;
    gap: var(--large-gap);
  }

  p + p {
    margin-top: var(--default-gap);
  }
</style>
