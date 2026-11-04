<svelte:options immutable={true} />

<script>
  import {
    mdiAlertOutline,
    mdiArrowLeft,
    mdiCheck,
    mdiChevronDown,
  } from "@mdi/js";
  import {
    Anchor,
    Button,
    ErrorDetails,
    Icon,
    Select,
    Switch,
    Textbox,
  } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import {
    AppAnchorButton,
    CopyField,
    GasControls,
    SectionHead,
  } from "$lib/components";
  import { LEGAL_LINKS } from "$lib/constants";
  import { currencies, formatFee } from "$lib/dusk/currency";
  import { section } from "$lib/dusk/motion";
  import { createNumberFormatter } from "$lib/dusk/number";
  import {
    gasPriceStore,
    gasStore,
    networkStore,
    settingsStore,
    walletStore,
  } from "$lib/stores";
  import { AUTO_LOCK_MINUTES } from "$lib/stores/settingsStore";
  import {
    HIGHEST_DEFAULT_GAS_LIMIT,
    areValidGasSettings,
  } from "$lib/contracts";
  import { forgetBridgeRecords } from "$lib/bridge/forgetBridgeRecords";
  import { deleteContacts } from "$lib/contacts";
  import { ProfileNames, WalletsSettings } from "$lib/containers/Wallets";
  import { WalletChangedError } from "$lib/errors";
  import { forgetEvmWallets } from "$lib/web3/walletConnection";
  import { logout, pageTitle } from "$lib/navigation";
  import vault from "$lib/vault";
  import { lockWallets, openWalletName, walletDirectory } from "$lib/wallets";
  import { clearDirectory } from "$lib/wallets/directory";
  import { forgetEveryWalletData } from "$lib/wallets/walletData";

  // With one wallet, as before there were more.
  const RESET_ONE = {
    body: "Resetting clears the cache, settings, contacts and connected EVM wallets, not your funds. You'll need your recovery phrase to restore access, so make sure it's stored securely.",
    button: "Reset Wallet",
    confirm:
      "Confirm you've saved your recovery phrase before resetting the wallet. Proceed?",
    heading: "Reset wallet",
  };

  const RESET_ALL = {
    body: "Removes every wallet from this browser, with its settings and contacts. Your funds stay on Dusk. You need each wallet's recovery phrase to get back in.",
    button: "Reset all wallets",
    confirm:
      "This removes every wallet from this browser. Confirm you've saved each recovery phrase before resetting. Proceed?",
    heading: "Reset all wallets",
  };

  // Every wallet's data goes, and every phrase: the wallets' own first,
  // while the directory still lists them.
  const resetWallet = () =>
    walletStore
      .clearLocalData()
      .then(async () => {
        await forgetEveryWalletData();
        await deleteContacts();
        forgetBridgeRecords({ times: true });
        await forgetEvmWallets();
        await vault.clear();
        clearDirectory();
        settingsStore.reset();
        await logout(false);
      })
      .catch((err) => {
        resetError = err;
      });

  /**
   * Custom gas sets a gas limit and a gas price for every operation. They
   * start from the highest default limit, which suits every operation, and
   * from the node's price.
   *
   * @param {CustomEvent<boolean>} event
   */
  function handleCustomGasChange(event) {
    settingsStore.update((store) => ({
      ...store,
      customGasLimit: event.detail ? HIGHEST_DEFAULT_GAS_LIMIT : null,
      customGasPrice: event.detail ? $gasPriceStore : null,
    }));
  }

  function handleResetWalletClick() {
    if (confirm(reset.confirm)) {
      resetError = null;
      resetWallet();
    }
  }

  /** @type {(currencies: { code: string, currency: string }[]) => SelectOption[]} */
  const currenciesToOptions = (items) =>
    items.map(({ code, currency }) => ({ label: currency, value: code }));
  const { gasLimitLower, gasLimitUpper, gasPriceLower } = $gasStore;

  /** @type {SelectOption[]} */
  const autoLockOptions = [
    ...AUTO_LOCK_MINUTES.map((minutes) => ({
      label: `After ${minutes} minutes`,
      value: String(minutes),
    })),
    { label: "Off", value: "0" },
  ];

  // Auto-lock is for a wallet with a password: one without always locks.
  const hasPassword = vault.exists();

  let isAdvancedOpen = false;

  const { resyncing } = walletStore;

  /**
   * Where a resync starts: the block the wallet was made at, the first
   * block, or one typed.
   *
   * @type {"creation" | "genesis" | "typed"}
   */
  let resyncChoice = "creation";

  /** The block typed for a resync to start at, as typed: none at first. */
  let resyncTypedText = "";

  /**
   * The network's latest block, which a block typed can't be past: null
   * until it's read, or while it can't be.
   *
   * @type {bigint | null}
   */
  let networkHeight = null;

  /** @type {"failed" | "reading" | ""} */
  let networkHeightState = "";

  /** Whether the resync waits for its confirmation. */
  let isConfirmingResync = false;

  /**
   * Asks again before a resync, for the start and the wallet given.
   *
   * @param {...unknown} _
   */
  // eslint-disable-next-line no-unused-vars
  function askAgain(..._) {
    isConfirmingResync = false;
  }

  /**
   * Reads the network's latest block as a block is to be typed, which
   * can't be past it: once, or again after it couldn't be read.
   */
  function readNetworkHeight() {
    if (resyncChoice !== "typed" || networkHeight !== null) {
      return;
    }

    networkHeightState = "reading";
    networkStore.getCurrentBlockHeight().then(
      (height) => {
        networkHeight = height;
        networkHeightState = "";
      },
      () => {
        networkHeightState = "failed";
      }
    );
  }

  /**
   * Syncs the open wallet again from the block chosen: what it synced here
   * is cleared first.
   *
   * @param {bigint} from
   */
  function resync(from) {
    isConfirmingResync = false;
    walletStore.resync(from).then(
      () => {
        toast(
          "success",
          `Resynced from block ${numberFormatter(from)}.`,
          mdiCheck
        );
      },
      (error) => {
        toast(
          "error",
          error instanceof WalletChangedError
            ? error.message
            : "Couldn't resync. Try again.",
          mdiAlertOutline
        );
      }
    );
  }

  /** @type {Error | null} */
  let resetError = null;

  /**
   * How many wallets this browser holds, those this tab didn't open too, as
   * another password opens them: Reset removes them all.
   */
  let walletsHere = 0;

  /**
   * Counts the wallets here again, as they come and go here or in another
   * tab: the ones known at once, then the vault's.
   *
   * @param {Array<{ key: string }>} held The wallets this tab opened
   * @param {import("$lib/wallets/directory").WalletDirectory} directory
   */
  function countWallets(held, directory) {
    walletsHere = new Set([
      ...held.map(({ key }) => key),
      ...Object.keys(directory.wallets),
    ]).size;
    vault.count().then(
      (count) => {
        walletsHere = Math.max(count, held.length);
      },
      () => {}
    );
  }

  $: ({ syncStatus, walletKey, wallets } = $walletStore);
  $: countWallets(wallets, $walletDirectory);

  // More than one wallet here: Lock and auto-lock lock them all, Reset
  // removes them all, and they say so.
  $: several = walletsHere > 1;
  $: reset = several ? RESET_ALL : RESET_ONE;

  // The block the open wallet was made at, when it was made here.
  $: walletHeight = $walletDirectory.wallets[walletKey]?.height;
  $: ({
    autoLockMinutes,
    currency,
    customGasLimit,
    customGasPrice,
    darkMode,
    language,
    walletCreationBlockHeight: settingsHeight,
  } = $settingsStore);

  // A wallet made here kept its block; the first one, in the settings.
  $: walletCreationBlockHeight = walletHeight
    ? BigInt(walletHeight)
    : !walletKey || walletKey === $walletDirectory.legacy
      ? settingsHeight
      : 0n;
  $: hasCustomGas = customGasLimit !== null && customGasPrice !== null;
  $: isGasValid =
    customGasLimit !== null && customGasPrice !== null
      ? areValidGasSettings(customGasPrice, customGasLimit)
      : true;

  // The gas values can't be folded away while they need fixing.
  $: if (!isGasValid) {
    isAdvancedOpen = true;
  }

  $: numberFormatter = createNumberFormatter(language);

  // A wallet whose creation block isn't known here resyncs from the first
  // block, or one typed.
  $: if (!walletCreationBlockHeight && resyncChoice === "creation") {
    resyncChoice = "genesis";
  }

  /** @type {SelectOption[]} */
  $: resyncOptions = [
    ...(walletCreationBlockHeight
      ? [
          {
            label: `Creation block, ${numberFormatter(walletCreationBlockHeight)}`,
            value: "creation",
          },
        ]
      : []),
    { label: "Genesis, block 0", value: "genesis" },
    { label: "Another block", value: "typed" },
  ];
  // A block typed: a whole number, 0 or more; null for none yet, or one
  // that isn't.
  $: resyncTyped = /^\d+$/.test(resyncTypedText.trim())
    ? BigInt(resyncTypedText.trim())
    : null;
  $: resyncStart =
    resyncChoice === "creation"
      ? walletCreationBlockHeight
      : resyncChoice === "genesis"
        ? 0n
        : resyncTyped;

  $: isResyncTypedInvalid =
    resyncChoice === "typed" &&
    resyncTypedText.trim() !== "" &&
    resyncTyped === null;
  $: isResyncTypedPast =
    resyncChoice === "typed" &&
    resyncTyped !== null &&
    networkHeight !== null &&
    resyncTyped > networkHeight;
  $: canResync =
    $resyncing === null &&
    resyncStart !== null &&
    (resyncChoice !== "typed" ||
      (networkHeight !== null && !isResyncTypedPast));

  // Another start, or another wallet open, is asked about again.
  $: askAgain(resyncStart, walletKey);
</script>

<section class="settings">
  <header class="settings__header">
    <h1 use:pageTitle>Settings</h1>
  </header>

  <div class="settings__content">
    <WalletsSettings />
    <hr />
    <ProfileNames />
    <hr />
    <article class="settings-group">
      <SectionHead>Preferences</SectionHead>
      <div class="settings-group__multi-control-content">
        <label
          class="settings-group__control settings-group__control--with-label"
          for={undefined}
        >
          <span>Currency</span>
          <Select
            className="settings-group__control settings-group__control--with-label"
            value={currency}
            on:change={(evt) => {
              settingsStore.update((store) => {
                const option = /** @type {HTMLInputElement} */ (evt.target);

                store.currency = option.value;

                return store;
              });
            }}
            options={currenciesToOptions(currencies)}
          />
        </label>
        <label
          class="settings-group__control settings-group__control--switch"
          for={undefined}
        >
          <span>Dark mode</span>
          <Switch
            aria-label="Dark mode"
            on:change={(event) => {
              settingsStore.update((store) => {
                store.darkMode = event.detail;

                return store;
              });
            }}
            value={darkMode}
          />
        </label>
        {#if hasPassword}
          <label
            class="settings-group__control settings-group__control--with-label"
            for={undefined}
          >
            <span>Lock when inactive</span>
            <Select
              className="settings-group__control settings-group__control--with-label"
              value={String(autoLockMinutes)}
              on:change={(evt) => {
                const option = /** @type {HTMLSelectElement} */ (evt.target);

                settingsStore.update((store) => ({
                  ...store,
                  autoLockMinutes: Number(option.value),
                }));
              }}
              options={autoLockOptions}
            />
          </label>
          {#if several}
            <p class="settings-group__note">
              Locks every wallet after this long without use.
            </p>
          {/if}
        {/if}
      </div>
    </article>
    <hr />
    <article class="settings-group">
      <h2 class="h4 settings-group__heading">
        <button
          aria-controls="settings-advanced"
          aria-expanded={isAdvancedOpen}
          class="settings-group__header settings-group__toggle"
          on:click={() => {
            isAdvancedOpen = isGasValid ? !isAdvancedOpen : true;
          }}
          type="button"
        >
          <span>Advanced</span>
          <Icon className="section-chevron" path={mdiChevronDown} />
        </button>
      </h2>
      {#if isAdvancedOpen}
        <div
          class="settings-group__multi-control-content"
          id="settings-advanced"
          transition:section={{ open: isAdvancedOpen }}
        >
          <label
            class="settings-group__control settings-group__control--switch"
            for={undefined}
          >
            <span>Custom gas</span>
            <Switch
              aria-label="Custom gas"
              on:change={handleCustomGasChange}
              value={hasCustomGas}
            />
          </label>
          {#if customGasLimit !== null && customGasPrice !== null}
            <GasControls
              on:gasSettings={(event) => {
                const { limit, price } = event.detail;

                settingsStore.update((store) => ({
                  ...store,
                  customGasLimit: limit,
                  customGasPrice: price,
                }));
              }}
              limit={customGasLimit}
              limitLower={gasLimitLower}
              limitUpper={gasLimitUpper}
              price={customGasPrice}
              priceLower={gasPriceLower}
            />
            {#if isGasValid}
              <p class="settings-group__note">
                Each transaction costs at most {formatFee(
                  customGasLimit * customGasPrice,
                  language,
                  { max: true }
                )} DUSK.
              </p>
            {/if}
          {:else}
            <p class="settings-group__note">
              The wallet uses the network's gas price, and a gas limit that
              suits each transaction.
            </p>
          {/if}
          {#if walletCreationBlockHeight}
            <div
              class="settings-group__control settings-group__control--with-label"
            >
              <span>Wallet creation block height</span>
              <CopyField
                className="settings-group__control"
                displayValue={numberFormatter(walletCreationBlockHeight)}
                name="Block Height"
                rawValue={String(walletCreationBlockHeight)}
              />
            </div>
          {/if}
          <div
            aria-labelledby="settings-resync"
            class="settings-group__control settings-group__control--with-label"
            role="group"
          >
            <span id="settings-resync">Resync</span>
            <p class="settings-group__note">
              Syncs this wallet again from the block you choose, after clearing
              its synced balances and history on this device. It can take a
              while. Contacts, settings and names stay.
            </p>
            <label
              class="settings-group__control settings-group__control--with-label"
              for={undefined}
            >
              <span>From</span>
              <Select
                className="settings-group__control settings-group__control--with-label"
                disabled={$resyncing !== null}
                on:change={readNetworkHeight}
                options={resyncOptions}
                bind:value={resyncChoice}
              />
            </label>
            {#if resyncChoice === "typed"}
              <Textbox
                aria-describedby="settings-resync-height"
                aria-invalid={isResyncTypedInvalid || isResyncTypedPast}
                aria-label="Block height"
                autocomplete="off"
                bind:value={resyncTypedText}
                className="settings-group__control"
                disabled={$resyncing !== null}
                inputmode="numeric"
                placeholder="Block height"
                type="text"
              />
              <p
                class="settings-group__note"
                class:settings-group__note--error={isResyncTypedInvalid ||
                  isResyncTypedPast ||
                  networkHeightState === "failed"}
                id="settings-resync-height"
              >
                {#if networkHeightState === "failed"}
                  Couldn't read the network's latest block.
                {:else if isResyncTypedInvalid}
                  Enter a block height of 0 or more.
                {:else if networkHeight !== null}
                  The maximum is {numberFormatter(networkHeight)}, the network's
                  latest block.
                {/if}
              </p>
            {/if}
            {#if $resyncing !== null}
              <p class="settings-group__note" role="status">
                Resyncing from block {numberFormatter($resyncing)}. It can take
                a while.
              </p>
            {:else if isConfirmingResync}
              <p>
                Resync {$openWalletName || "this wallet"} from block {numberFormatter(
                  resyncStart ?? 0n
                )}? Its balances and history clear, then fill in again as it
                syncs.
              </p>
              <div class="settings-group__buttons">
                <Button
                  on:click={() => {
                    if (resyncStart !== null) {
                      resync(resyncStart);
                    }
                  }}
                  text="Resync"
                  variant="secondary"
                />
                <Button
                  on:click={() => {
                    isConfirmingResync = false;
                  }}
                  text="Cancel"
                  variant="tertiary"
                />
              </div>
            {:else}
              <div class="settings-group__buttons">
                <Button
                  disabled={!canResync}
                  on:click={() => {
                    isConfirmingResync = true;
                  }}
                  text="Resync"
                  variant="secondary"
                />
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </article>
    <hr />
    <article class="settings-group">
      <SectionHead>Support</SectionHead>
      <p>
        Read the <Anchor
          className="text-link"
          rel="noopener noreferrer"
          target="_blank"
          href="https://docs.dusk.network">Dusk Docs</Anchor
        >, ask on
        <Anchor
          className="text-link"
          rel="noopener noreferrer"
          target="_blank"
          href="https://discord.gg/dusk-official">Discord</Anchor
        >, or report issues on
        <Anchor
          className="text-link"
          rel="noopener noreferrer"
          target="_blank"
          href="https://github.com/dusk-network/web-wallet/issues"
          >GitHub</Anchor
        >.
      </p>
      <p>
        <Anchor
          className="text-link"
          href={LEGAL_LINKS.TERMS_OF_USE}
          rel="noopener noreferrer"
          target="_blank">Terms of use</Anchor
        >
        ·
        <Anchor
          className="text-link"
          href={LEGAL_LINKS.PRIVACY_POLICY}
          rel="noopener noreferrer"
          target="_blank">Privacy policy</Anchor
        >
      </p>
    </article>
    <hr />
    <article class="settings-group">
      <SectionHead>{reset.heading}</SectionHead>
      <div class="settings-group__multi-control-content">
        <p>{reset.body}</p>
        <ErrorDetails
          error={resetError}
          summary="Couldn't reset the wallet. Try again."
        />
        <Button
          className="settings-group__button--state--danger"
          disabled={syncStatus.isInProgress}
          data-tooltip-disabled={!syncStatus.isInProgress}
          data-tooltip-id="main-tooltip"
          data-tooltip-text="Not allowed to reset while syncing"
          data-tooltip-type="warning"
          on:click={handleResetWalletClick}
          text={reset.button}
        />
      </div>
    </article>
  </div>
</section>

<div class="settings-actions">
  <AppAnchorButton
    href="/dashboard"
    disabled={!isGasValid}
    variant="tertiary"
    icon={{ path: mdiArrowLeft }}
    text="Back"
  />
  <Button
    on:click={() => lockWallets()}
    variant="tertiary"
    text={several ? "Lock" : "Lock Wallet"}
  />
</div>

<style lang="postcss">
  :global {
    .settings {
      width: min(100%, 44rem);
      margin: 0 auto;
      padding: 2rem 1.5rem 3rem;

      & > * {
        padding: 0;
      }

      &,
      &__content {
        display: flex;
        flex-direction: column;
        gap: var(--default-gap);
      }

      &__content {
        overflow-y: auto;
        scrollbar-color: var(--surface-border-color) transparent;

        /* Room for the opening bracket a head hangs left of its edge. */
        @media (max-width: 47.99rem) {
          margin-left: -0.75rem;
          padding-left: 0.75rem;
        }
      }

      &__header h1 {
        font-size: 1.75rem;
        font-weight: 500;
        line-height: 1.15;
      }
    }

    .settings-group {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--small-gap);
      width: 100%;
      margin-bottom: 0.5em;

      &__header {
        display: flex;
        align-items: center;
        gap: 0.75em;
        color: var(--calm-muted);
      }

      &__heading {
        color: var(--on-background-color);
        font-size: 1rem;
        font-weight: 500;
        line-height: 140%;
      }

      &__control {
        align-items: center;
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        gap: 0.5em;
        width: 100%;

        &--with-label {
          flex-direction: column;
          justify-content: start;
          align-items: stretch;

          & > span {
            line-height: 140%;
          }
        }

        &--switch {
          background-color: var(--calm-s1);
          padding: 0.625em 0.875em;
          border-radius: 0.875rem;
        }
      }

      &__multi-control-content {
        display: flex;
        flex-direction: column;
        gap: var(--default-gap);
        width: 100%;
      }

      &__toggle {
        /* A 44 px tap, in the space of the other sections' headers. */
        min-height: 44px;
        margin-block: calc((1.05rem - 44px) / 2);
        padding: 0;
        border: none;
        background: none;
        color: inherit;
        font: inherit;
        letter-spacing: inherit;
        text-transform: inherit;
        cursor: pointer;
      }

      &__note {
        color: var(--muted-color);
        font-size: 0.875em;
        line-height: 1.4;

        &--error {
          color: var(--badge-error-color);
        }
      }

      &__buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      &:last-of-type {
        margin-bottom: 1em;
      }
    }

    .settings-actions {
      display: flex;
      flex-direction: row;
      justify-content: space-between;
      gap: var(--default-gap);
      box-sizing: border-box;
      width: min(100%, 44rem);
      margin: 0 auto;
      padding: 0 1.5rem;

      & > * {
        flex: 1;
      }
    }

    .dusk-button.settings-group__button--state--danger {
      background-color: var(--status-error-bg-color);
      border-color: var(--badge-error-color);
      color: var(--badge-error-color);
    }
  }
</style>
