<script>
  import { Button } from "$lib/dusk/components";
  import { AppAnchor, AppAnchorButton } from "$lib/components";
  import { IconHeadingCard } from "$lib/containers/Cards";

  /** @type {boolean} */
  export let tosAccepted = false;
</script>

<section>
  <IconHeadingCard heading="Terms &amp; Privacy Policy">
    <p>
      Your keys stay in this browser, and only you hold them: Dusk can't recover
      them. The wallet has no analytics, and gets the DUSK price from CoinGecko.
    </p>
    <p>
      Accepting means you agree to the <AppAnchor
        href="https://dusk.network/terms-of-use/"
        rel="noopener noreferrer"
        target="_blank">Terms of Use</AppAnchor
      > and the <AppAnchor
        href="https://dusk.network/privacy-policy/"
        rel="noopener noreferrer"
        target="_blank">Privacy Policy</AppAnchor
      >.
    </p>
    <div class="actions">
      <AppAnchorButton
        className="actions__action"
        href="/setup"
        text="Cancel"
        variant="tertiary"
      />
      <Button
        className="actions__action"
        text="Accept"
        on:click={() => {
          tosAccepted = true;
        }}
      />
    </div>
  </IconHeadingCard>
</section>

<style lang="postcss">
  .actions {
    display: flex;
    justify-content: space-between;
    margin-top: var(--default-gap);
    gap: var(--default-gap);
  }

  :global(.actions__action) {
    flex: 1;
  }
</style>
