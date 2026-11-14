<svelte:options immutable={true} />

<script>
  import { ErrorAlert, Wizard, WizardStep } from "$lib/dusk/components";

  import { ExistingWalletNotice, RecoveryWordsCheck } from "$lib/components";
  import { goto, takePlace } from "$lib/navigation";
  import { settingsStore } from "$lib/stores";
  import vault from "$lib/vault";
  import {
    initializeWallet,
    refreshLocalStoragePasswordInfo,
  } from "$lib/wallet";

  import AllSet from "../AllSet.svelte";
  import PasswordSetup from "../PasswordSetup.svelte";
  import TermsOfService from "../TermsOfService.svelte";

  import MnemonicPhrase from "./MnemonicPhrase.svelte";
  import MnemonicPreSetup from "./MnemonicPreSetup.svelte";
  import NetworkSync from "./NetworkSync.svelte";

  /** @type {import("./$types").PageData} */
  export let data;

  /** @type {boolean} */
  let notice = false;

  /** @type {boolean} */
  let tosAccepted = false;

  /** @type {string} */
  let password = "";

  /** @type {boolean} */
  let isValidPassword = false;

  /** @type {boolean} */
  let showPasswordSetup = true;

  /** @type {boolean} */
  let agreementAccepted = false;

  /** Whether the words checked match what was written down. */
  let areWordsChecked = false;

  /** @type {string[]} */
  let mnemonicPhrase = [];

  /**
   * Whether the wallet made here is open: All set goes on to it only then,
   * as the wallet's pages are only for an open wallet.
   */
  let isWalletOpen = false;

  /** @type {Error | null} */
  let openError = null;

  const { userId } = $settingsStore;
  const { currentBlockHeight } = data;

  $: if (showPasswordSetup) {
    password = showPasswordSetup ? password : "";
  }
</script>

{#if !notice && userId}
  <div class="onboarding-wrapper">
    <ExistingWalletNotice bind:notice flow="create" />
  </div>
{:else if !tosAccepted}
  <div class="onboarding-wrapper">
    <TermsOfService bind:tosAccepted />
  </div>
{:else}
  <Wizard fullHeight={true} steps={6} let:key>
    <WizardStep
      step={0}
      {key}
      showStepper={true}
      backButton={{
        disabled: false,
        href: "/setup",
        isAnchor: true,
      }}
      nextButton={{ disabled: !agreementAccepted }}
    >
      <h2 class="h1" slot="heading">Back up your recovery phrase</h2>
      <MnemonicPreSetup bind:isValid={agreementAccepted} />
    </WizardStep>
    <WizardStep step={1} {key} showStepper={true}>
      <h2 class="h1" slot="heading">Back up your recovery phrase</h2>
      <MnemonicPhrase bind:mnemonicPhrase />
    </WizardStep>
    <!-- Three of the words, as written down: checked, or for later, as
      Settings checks them too. -->
    <WizardStep
      step={2}
      {key}
      showStepper={true}
      nextButton={{
        disabled: false,
        label: areWordsChecked ? "Next" : "Skip for now",
      }}
    >
      <h2 class="h1" slot="heading">Check your recovery words</h2>
      <RecoveryWordsCheck
        on:checked={() => {
          areWordsChecked = true;
        }}
        words={mnemonicPhrase}
      />
    </WizardStep>
    <WizardStep
      step={3}
      {key}
      showStepper={true}
      nextButton={{
        action: async () => {
          await refreshLocalStoragePasswordInfo(mnemonicPhrase, password);
        },
        disabled: !isValidPassword,
      }}
    >
      <h2 class="h1" slot="heading">Set a password</h2>
      <PasswordSetup
        bind:password
        bind:isValid={isValidPassword}
        bind:isToggled={showPasswordSetup}
      />
    </WizardStep>
    <WizardStep
      step={4}
      {key}
      showStepper={true}
      backButton={{
        action: () => vault.clear(),
        disabled: false,
      }}
      nextButton={{
        action: async () => {
          try {
            await initializeWallet(
              mnemonicPhrase.join(" "),
              currentBlockHeight
            );
            settingsStore.update((settings) => ({
              ...settings,
              walletCreationBlockHeight: currentBlockHeight,
            }));
            isWalletOpen = true;
          } catch (error) {
            openError =
              error instanceof Error ? error : new Error(String(error));
          } finally {
            mnemonicPhrase = [];
          }
        },
        disabled: false,
      }}
    >
      <h2 class="h1" slot="heading">Sync</h2>
      <NetworkSync {currentBlockHeight} />
    </WizardStep>
    <WizardStep
      step={5}
      {key}
      showStepper={true}
      hideBackButton={true}
      nextButton={{
        action: async () => {
          // Where a link left off, as a payment it asks for.
          await goto(takePlace() ?? "/dashboard", { replaceState: true });
        },
        disabled: !isWalletOpen,
      }}
    >
      <h2 class="h1" slot="heading">Welcome to Dusk</h2>
      {#if openError}
        <ErrorAlert
          description="Restore it with the recovery phrase you wrote down."
          error={openError}
          summary="The wallet couldn't open"
        />
      {:else}
        <AllSet />
      {/if}
    </WizardStep>
  </Wizard>
{/if}
