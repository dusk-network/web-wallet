<svelte:options immutable={true} />

<script>
  import { mdiArrowLeft, mdiChevronDown } from "@mdi/js";
  import {
    Anchor,
    Button,
    ErrorDetails,
    Icon,
    Select,
    Switch,
  } from "$lib/dusk/components";
  import {
    AppAnchorButton,
    CopyField,
    GasControls,
    SectionHead,
  } from "$lib/components";
  import { currencies, formatFee } from "$lib/dusk/currency";
  import { createNumberFormatter } from "$lib/dusk/number";
  import {
    gasPriceStore,
    gasStore,
    settingsStore,
    walletStore,
  } from "$lib/stores";
  import { AUTO_LOCK_MINUTES } from "$lib/stores/settingsStore";
  import {
    HIGHEST_DEFAULT_GAS_LIMIT,
    areValidGasSettings,
  } from "$lib/contracts";
  import { deleteContacts } from "$lib/contacts";
  import { logout } from "$lib/navigation";
  import loginInfoStorage from "$lib/services/loginInfoStorage";

  const confirmResetWalletMessage =
    "Confirm you've saved your recovery phrase before resetting the wallet. Proceed?";

  const resetWallet = () =>
    walletStore
      .clearLocalData()
      .then(async () => {
        await deleteContacts();
        await loginInfoStorage.remove();
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
    // eslint-disable-next-line no-alert
    if (confirm(confirmResetWalletMessage)) {
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
  const hasPassword = loginInfoStorage.get() !== null;

  let isAdvancedOpen = false;

  /** @type {Error | null} */
  let resetError = null;

  $: ({ syncStatus } = $walletStore);
  $: ({
    autoLockMinutes,
    currency,
    customGasLimit,
    customGasPrice,
    darkMode,
    language,
    walletCreationBlockHeight,
  } = $settingsStore);
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
</script>

<section class="settings">
  <header class="settings__header">
    <h2>Settings</h2>
  </header>

  <div class="settings__content">
    <article class="settings-group">
      <SectionHead level={3}>Preferences</SectionHead>
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
        {/if}
      </div>
    </article>
    <hr />
    <article class="settings-group">
      <h3 class="h4 settings-group__heading">
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
          <Icon className="settings-group__toggle-icon" path={mdiChevronDown} />
        </button>
      </h3>
      {#if isAdvancedOpen}
        <div
          class="settings-group__multi-control-content"
          id="settings-advanced"
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
        </div>
      {/if}
    </article>
    <hr />
    <article class="settings-group">
      <SectionHead level={3}>Support</SectionHead>
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
    </article>
    <hr />
    <article class="settings-group">
      <SectionHead level={3}>Reset wallet</SectionHead>
      <div class="settings-group__multi-control-content">
        <p>
          Resetting clears the cache, settings and contacts, not your funds.
          You'll need your recovery phrase to restore access, so make sure it's
          stored securely.
        </p>
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
          text="Reset Wallet"
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
    on:click={() => logout(false)}
    variant="tertiary"
    text="Lock Wallet"
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
      }

      &__header h2 {
        font-size: 1.75rem;
        font-weight: 500;
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

      &__toggle[aria-expanded="true"] .settings-group__toggle-icon {
        transform: rotate(180deg);
      }

      &__note {
        color: var(--muted-color);
        font-size: 0.875em;
        line-height: 1.4;
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
