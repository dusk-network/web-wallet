<script>
  import { amountForField } from "@dusk-network/app-core/amounts";
  /**
   * Settings: the password on any send above an amount chosen. It's off until
   * it's turned on, and every change takes the password, as turning it off in
   * a tab left unlocked would otherwise undo it. A wallet without a password
   * has none to ask for, and is told so.
   */
  import { mdiCheck } from "@mdi/js";

  import { Button, Switch, Textbox } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import { formatDuskExact, formatDuskPlain } from "$lib/dusk/currency";
  import { getDecimalSeparator } from "$lib/dusk/number";
  import { randomUUID } from "$lib/dusk/string";
  import { UnlockPasswordField } from "$lib/components";
  import {
    amountProblem,
    readDuskInput,
  } from "$lib/components/Stake/stakeAmount";
  import { InvalidPasswordError } from "$lib/errors";
  import {
    sendPasswordLimit,
    setSendPasswordLimit,
  } from "$lib/security/sendPassword";
  import { settingsStore, walletStore } from "$lib/stores";
  import vault from "$lib/vault";

  const id = randomUUID();
  const hasPassword = vault.exists();

  /** The amount it asks above: null while it's off. */
  let limit = sendPasswordLimit();

  /** Whether a change waits for the password. */
  let isEditing = false;

  /** Whether the change turns it on, or keeps it on. */
  let wantsOn = limit !== null;

  let amountText = "";
  let amountError = "";
  let password = "";
  let passwordError = "";
  let formError = "";
  let busy = false;

  /** @param {boolean} on */
  function startEditing(on) {
    wantsOn = on;
    isEditing = true;
    amountText =
      limit === null
        ? ""
        : amountForField(formatDuskPlain(limit), getDecimalSeparator(language));
    amountError = "";
    password = "";
    passwordError = "";
    formError = "";
  }

  function stopEditing() {
    isEditing = false;
    wantsOn = limit !== null;
    amountText = "";
    password = "";
  }

  /**
   * Why what's typed can't be the amount: an example says what 0 does too.
   *
   * @param {string} text
   */
  function amountReason(text) {
    const problem = amountProblem(text, language, "100");

    return !problem || problem.startsWith("Enter")
      ? `Enter an amount such as 100 or 100${getDecimalSeparator(language)}5. 0 asks on every send.`
      : problem;
  }

  async function save() {
    const lux = wantsOn ? readDuskInput(amountText, language) : null;

    amountError = wantsOn && lux === null ? amountReason(amountText) : "";
    passwordError = password ? "" : "Enter your password.";
    formError = "";

    if (busy || amountError || passwordError) {
      return;
    }

    busy = true;

    try {
      await vault.check(password, $walletStore.walletKey);
      setSendPasswordLimit(lux);
      limit = lux;
      isEditing = false;
      wantsOn = lux !== null;
      password = "";
      toast("success", "Saved.", mdiCheck);
    } catch (error) {
      if (error instanceof InvalidPasswordError) {
        passwordError = "Wrong password.";
      } else {
        formError = "Couldn't check the password. Try again.";
      }
    } finally {
      busy = false;
    }
  }

  /**
   * Another tab's change shows here too, as it counts here too.
   *
   * @param {StorageEvent} event
   */
  function followOtherTabs(event) {
    if (event.storageArea === localStorage && !isEditing) {
      limit = sendPasswordLimit();
      wantsOn = limit !== null;
    }
  }

  $: ({ language } = $settingsStore);
</script>

<svelte:window on:storage={followOtherTabs} />

{#if hasPassword}
  <label
    class="settings-group__control settings-group__control--switch"
    for={undefined}
  >
    <span>Ask for the password on big sends</span>
    <Switch
      aria-label="Ask for the password on big sends"
      disabled={busy}
      on:change={(event) => startEditing(event.detail)}
      value={wantsOn}
    />
  </label>
  {#if isEditing}
    <form
      class="send-password-setting"
      novalidate
      on:submit|preventDefault={save}
    >
      {#if wantsOn}
        <div class="send-password-setting__field">
          <label for="{id}-amount">Above this amount, in DUSK</label>
          <Textbox
            aria-describedby={amountError ? `${id}-amount-error` : undefined}
            aria-invalid={amountError ? "true" : undefined}
            autocomplete="off"
            bind:value={amountText}
            disabled={busy}
            id="{id}-amount"
            inputmode="decimal"
            on:input={() => {
              amountError = "";
            }}
            type="text"
          />
          {#if amountError}
            <p
              class="send-password-setting__error"
              id="{id}-amount-error"
              role="alert"
            >
              {amountError}
            </p>
          {/if}
        </div>
      {/if}
      <UnlockPasswordField
        bind:error={passwordError}
        bind:value={password}
        disabled={busy}
      />
      {#if formError}
        <p class="send-password-setting__error" role="alert">{formError}</p>
      {/if}
      <div class="settings-group__buttons">
        <Button
          disabled={busy}
          text={wantsOn ? "Save" : "Turn off"}
          type="submit"
          variant="secondary"
        />
        <Button
          disabled={busy}
          on:click={stopEditing}
          text="Cancel"
          variant="tertiary"
        />
      </div>
    </form>
  {:else if limit !== null}
    <div class="send-password-setting__on">
      <p class="settings-group__note">
        Sends, stakes, shielding and the bridge above {formatDuskExact(
          limit,
          language
        )} DUSK, network fee included.
      </p>
      <Button
        on:click={() => startEditing(true)}
        size="small"
        text="Change"
        variant="tertiary"
      />
    </div>
  {/if}
{:else}
  <p class="settings-group__note">
    Asking for the password on big sends needs a wallet with a password. This
    one opens with its recovery phrase, so there's none to ask for.
  </p>
{/if}

<style lang="postcss">
  .send-password-setting,
  .send-password-setting__field {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .send-password-setting {
    gap: var(--default-gap);
  }

  .send-password-setting__field label {
    font-size: 0.875rem;
    font-weight: 500;
  }

  .send-password-setting__error {
    color: var(--calm-danger);
    font-size: 0.875rem;
    line-height: 1.4;
  }

  .send-password-setting__on {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
</style>
