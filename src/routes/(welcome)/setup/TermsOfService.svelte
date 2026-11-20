<script>
  import { Button } from "$lib/dusk/components";
  import { AppAnchor, AppAnchorButton } from "$lib/components";
  import { LEGAL_LINKS } from "$lib/constants";
  import { IconHeadingCard } from "$lib/containers/Cards";

  /** @type {boolean} */
  export let tosAccepted = false;
</script>

<section>
  <IconHeadingCard heading="Terms and privacy">
    <p>
      Your keys stay in this browser, and only you hold them: Dusk can't recover
      them.
    </p>
    <p>No analytics. The DUSK price comes from CoinGecko.</p>
    <p>
      Accepting means you agree to the <AppAnchor
        className="text-link"
        href={LEGAL_LINKS.TERMS_OF_USE}
        rel="noopener noreferrer"
        target="_blank">Terms of use</AppAnchor
      > and <AppAnchor
        className="text-link"
        href={LEGAL_LINKS.PRIVACY_POLICY}
        rel="noopener noreferrer"
        target="_blank">Privacy policy</AppAnchor
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
