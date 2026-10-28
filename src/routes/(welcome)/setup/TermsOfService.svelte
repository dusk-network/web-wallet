<script>
  import { Button } from "$lib/dusk/components";
  import { AppAnchor, AppAnchorButton } from "$lib/components";
  import { LEGAL_LINKS } from "$lib/constants";
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
        className="text-link"
        href={LEGAL_LINKS.TERMS_OF_USE}
        rel="noopener noreferrer"
        target="_blank">Terms of Use</AppAnchor
      > and the <AppAnchor
        className="text-link"
        href={LEGAL_LINKS.PRIVACY_POLICY}
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
