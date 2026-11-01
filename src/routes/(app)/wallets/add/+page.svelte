<svelte:options immutable={true} />

<script>
  /**
   * Add wallet: another recovery phrase beside the ones here, created or
   * imported with the screens a first wallet is set up with, then sealed
   * under the password the wallets share. The new wallet opens.
   */
  import { mdiArrowLeft, mdiPlus, mdiRestore, mdiWalletOutline } from "@mdi/js";
  import { onDestroy } from "svelte";

  import { Button, Icon } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import { MnemonicInput, UnlockPasswordField } from "$lib/components";
  import { InvalidPasswordError } from "$lib/errors";
  import { goto, pageTitle } from "$lib/navigation";
  import { networkStore, walletStore } from "$lib/stores";
  import vault, { DUPLICATE_PHRASE, nextWalletNumber } from "$lib/vault";
  import { getSeedFromMnemonic, profileGeneratorFrom } from "$lib/wallet";
  import { addWallet, walletDirectory, walletLabel } from "$lib/wallets";

  import MnemonicPhrase from "../../../(welcome)/setup/create/MnemonicPhrase.svelte";
  import MnemonicPreSetup from "../../../(welcome)/setup/create/MnemonicPreSetup.svelte";
  import MnemonicValidate from "../../../(welcome)/setup/create/MnemonicValidate.svelte";
  import NetworkSyncSettings from "../../../(welcome)/setup/restore/NetworkSyncSettings.svelte";

  /**
   * Where the flow is: choosing, then, to create one, the agreement, the
   * phrase and its check; to import one, its words and where it syncs
   * from; and for both, the password.
   *
   * @type {"agree" | "choose" | "password" | "phrase" | "sync" | "verify" | "words"}
   */
  let step = "choose";

  /** @type {"create" | "import"} */
  let mode = "create";

  // Create: the new phrase, the agreement, and the words tapped back.
  /** @type {string[]} */
  let mnemonicPhrase = [];

  let agreed = false;

  /** @type {string[]} */
  let enteredMnemonicPhrase = [];

  let isPhraseRepeated = false;

  // Import: the words typed or pasted, and the block to sync from.
  let importedPhrase = "";

  let isImportValid = false;

  let phraseError = "";

  /** @type {bigint} */
  let blockHeight = 0n;

  let isValidBlockHeight = true;

  // The password, and what went wrong.
  let password = "";

  let passwordError = "";

  let formError = "";

  let busy = false;

  /** @param {"create" | "import"} next */
  function choose(next) {
    mode = next;
    step = next === "create" ? "agree" : "words";
  }

  /**
   * The imported phrase, unless it's one here already: then it says so
   * under the words, before anything else is asked.
   */
  async function checkWords() {
    try {
      const generator = await profileGeneratorFrom(
        getSeedFromMnemonic(importedPhrase)
      );
      const account = String((await generator.default).account);
      const known =
        Object.values($walletDirectory.wallets).some(
          ({ walletId }) => walletId === account
        ) || $walletStore.profiles.some((p) => String(p.account) === account);

      if (known) {
        phraseError = DUPLICATE_PHRASE;
      } else {
        step = "sync";
      }
    } catch (error) {
      phraseError =
        error instanceof Error ? error.message : "Couldn't read the phrase.";
    }
  }

  /** @param {unknown} error */
  function refused(error) {
    busy = false;

    if (error instanceof InvalidPasswordError) {
      passwordError = "Wrong password.";
    } else {
      formError =
        error instanceof Error ? error.message : "Couldn't add the wallet.";
    }
  }

  /**
   * Where the new wallet syncs from: one made here, from the block it's
   * made at, which Settings shows; one imported, from the block given, or
   * the first.
   *
   * @returns {Promise<{ height?: bigint, syncFrom: bigint }>}
   */
  const syncOptions = () =>
    mode === "create"
      ? networkStore
          .getCurrentBlockHeight()
          .then((height) => ({ height, syncFrom: height }))
      : Promise.resolve({ syncFrom: blockHeight });

  // Added for the wallet open as the page is drawn: none once another opens.
  const add = walletStore.forThisWallet()(addWallet);

  /** The wallet sealed under the password the wallets share, and opened. */
  async function submit() {
    passwordError = password ? "" : "Enter your password.";
    formError = "";

    if (busy || passwordError) {
      return;
    }

    busy = true;

    try {
      await add(
        mode === "create" ? mnemonicPhrase.join(" ") : importedPhrase,
        password,
        await syncOptions()
      );
      password = "";
      toast("success", "Wallet added.", mdiWalletOutline);
      await goto("/dashboard");
    } catch (error) {
      refused(error);
    }
  }

  function back() {
    passwordError = "";
    formError = "";

    if (step === "choose") {
      // Where Add wallet was chosen: the switcher, or Settings.
      if (history.length > 1) {
        history.back();
      } else {
        goto("/settings");
      }
    } else if (step === "agree" || step === "words") {
      step = "choose";
    } else if (step === "phrase") {
      step = "agree";
    } else if (step === "verify") {
      enteredMnemonicPhrase = [];
      step = "phrase";
    } else if (step === "sync") {
      step = "words";
    } else {
      step = mode === "create" ? "verify" : "sync";
    }
  }

  // Nothing of the phrase or the password is kept once the page goes.
  onDestroy(() => {
    mnemonicPhrase = [];
    enteredMnemonicPhrase = [];
    importedPhrase = "";
    password = "";
  });

  // The wallet the phrase becomes, by the number the wallets here give the
  // next one.
  $: landing = `This becomes ${walletLabel({
    n: nextWalletNumber(vault.list() ?? $walletStore.wallets),
  })}.`;
  $: verb = mode === "create" ? "Add wallet" : "Import wallet";
</script>

<section class="add-wallet">
  <header class="add-wallet__header">
    <h1 use:pageTitle>Add wallet</h1>
    {#if step === "choose"}
      <p class="add-wallet__lead">
        Your password unlocks every wallet in this browser.
      </p>
    {:else}
      <p class="add-wallet__lead">{landing}</p>
    {/if}
  </header>

  {#if step === "choose"}
    <div class="add-wallet__choices">
      <button
        class="add-wallet__choice"
        on:click={() => choose("create")}
        type="button"
      >
        <Icon path={mdiPlus} />
        <span class="add-wallet__choice-text">
          <span class="add-wallet__choice-title">Create wallet</span>
          <span class="add-wallet__choice-sub">Get a new recovery phrase</span>
        </span>
      </button>
      <button
        class="add-wallet__choice"
        on:click={() => choose("import")}
        type="button"
      >
        <Icon path={mdiRestore} />
        <span class="add-wallet__choice-text">
          <span class="add-wallet__choice-title">Import wallet</span>
          <span class="add-wallet__choice-sub"
            >Use a recovery phrase you have</span
          >
        </span>
      </button>
    </div>
  {:else if step === "agree"}
    <MnemonicPreSetup bind:isValid={agreed} />
  {:else if step === "phrase"}
    <MnemonicPhrase bind:mnemonicPhrase />
  {:else if step === "verify"}
    <MnemonicValidate
      bind:enteredMnemonicPhrase
      bind:isValid={isPhraseRepeated}
      {mnemonicPhrase}
    />
  {:else if step === "words"}
    <MnemonicInput
      bind:isValid={isImportValid}
      bind:mnemonic={importedPhrase}
      error={phraseError}
      on:change={() => {
        phraseError = "";
      }}
    />
  {:else if step === "sync"}
    <NetworkSyncSettings bind:blockHeight bind:isValid={isValidBlockHeight} />
  {:else}
    <form
      class="add-wallet__password"
      on:submit|preventDefault={submit}
      novalidate
    >
      <UnlockPasswordField
        bind:error={passwordError}
        bind:value={password}
        disabled={busy}
      />
      {#if formError}
        <p class="add-wallet__error" role="alert">{formError}</p>
      {/if}
      <Button
        disabled={busy}
        text={busy ? (mode === "create" ? "Adding…" : "Importing…") : verb}
        type="submit"
        variant="primary"
      />
    </form>
  {/if}

  <div class="add-wallet__actions">
    <Button
      disabled={busy}
      icon={{ path: mdiArrowLeft }}
      on:click={back}
      text="Back"
      variant="tertiary"
    />
    {#if step === "agree"}
      <Button
        disabled={!agreed}
        on:click={() => {
          step = "phrase";
        }}
        text="Next"
        variant="primary"
      />
    {:else if step === "phrase"}
      <Button
        on:click={() => {
          step = "verify";
        }}
        text="Next"
        variant="primary"
      />
    {:else if step === "verify"}
      <Button
        disabled={!isPhraseRepeated}
        on:click={() => {
          step = "password";
        }}
        text="Next"
        variant="primary"
      />
    {:else if step === "words"}
      <Button
        disabled={!isImportValid || Boolean(phraseError)}
        on:click={checkWords}
        text="Next"
        variant="primary"
      />
    {:else if step === "sync"}
      <Button
        disabled={!isValidBlockHeight}
        on:click={() => {
          step = "password";
        }}
        text="Next"
        variant="primary"
      />
    {/if}
  </div>
</section>

<style lang="postcss">
  .add-wallet {
    display: flex;
    flex-direction: column;
    gap: var(--default-gap);
    width: min(100%, 44rem);
    margin: 0 auto;
    padding: 2rem 1.5rem 3rem;

    &__header {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;

      & h1 {
        font-size: 1.75rem;
        font-weight: 500;
        line-height: 1.15;
      }
    }

    &__lead {
      color: var(--calm-muted);
    }

    &__choices {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    &__choice {
      display: flex;
      align-items: center;
      gap: 0.875rem;
      width: 100%;
      min-height: 4rem;
      padding: 0.75rem 1rem;
      border: 1px solid var(--calm-line2);
      border-radius: 0.875rem;
      background: var(--calm-s1);
      color: var(--calm-text);
      font: inherit;
      text-align: left;
      cursor: pointer;

      &:hover {
        background: var(--calm-s2);
      }

      &:focus-visible {
        outline: 2px solid var(--calm-focus);
        outline-offset: 2px;
      }

      & :global(.dusk-icon) {
        flex: 0 0 auto;
        width: 1.25rem;
        height: 1.25rem;
        color: var(--calm-muted);
      }
    }

    &__choice-text {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
    }

    &__choice-title {
      font-weight: 500;
    }

    &__choice-sub {
      color: var(--calm-muted);
      font-size: 0.875rem;
    }

    &__password {
      display: flex;
      flex-direction: column;
      gap: var(--default-gap);
    }

    &__error {
      color: var(--calm-danger);
      font-size: 0.875rem;
      line-height: 1.4;
    }

    &__actions {
      display: flex;
      justify-content: space-between;
      gap: var(--default-gap);
      margin-top: 0.5rem;
    }
  }

  @media (max-width: 47.99rem) {
    .add-wallet {
      padding: 1rem 1rem 2rem;

      &__header h1 {
        font-size: 1.375rem;
      }
    }
  }
</style>
