<script>
  /**
   * Settings: unlocking with fingerprint or face. It's off until it's turned
   * on, which takes the password, as the keys it keeps are made from it. Turning
   * it off takes nothing: the password opens the wallets as ever. Where this
   * browser or device can't do it, it isn't offered.
   */
  import { mdiCheck } from "@mdi/js";
  import { onMount } from "svelte";

  import { Button, Switch } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import { UnlockPasswordField } from "$lib/components";
  import {
    InvalidPasswordError,
    PasskeyNoPrfError,
    WalletChangedError,
  } from "$lib/errors";
  import { canOfferPasskey } from "$lib/security/passkey";
  import vault from "$lib/vault";
  import { disablePasskey, enablePasskey } from "$lib/wallets";

  const hasPassword = vault.exists();

  /** Whether it's on, and whether this browser can be offered it. */
  let isOn = Boolean(vault.passkey());
  let canOffer = false;

  /** Whether the password is being asked for, to turn it on. */
  let isEditing = false;

  let password = "";
  let passwordError = "";
  let formError = "";
  let busy = false;

  /** That this device turned out not to be able to, just now. */
  let cantHere = false;

  onMount(async () => {
    canOffer = hasPassword && (await canOfferPasskey());
  });

  function stopEditing() {
    isEditing = false;
    password = "";
    passwordError = "";
    formError = "";
  }

  /** @param {boolean} on */
  async function turn(on) {
    if (on) {
      isEditing = true;
      cantHere = false;

      return;
    }

    stopEditing();

    if (isOn) {
      await disablePasskey();
      isOn = false;
      toast("success", "Turned off.", mdiCheck);
    }
  }

  async function turnOn() {
    passwordError = password ? "" : "Enter your password.";
    formError = "";

    if (busy || passwordError) {
      return;
    }

    busy = true;

    try {
      await enablePasskey(password);
      isOn = true;
      stopEditing();
      toast("success", "Fingerprint or face unlock is on.", mdiCheck);
    } catch (error) {
      if (error instanceof InvalidPasswordError) {
        passwordError = "Wrong password.";
      } else if (error instanceof PasskeyNoPrfError) {
        canOffer = false;
        cantHere = true;
        stopEditing();
      } else if (error instanceof WalletChangedError) {
        formError = error.message;
      } else if (
        error instanceof Error &&
        (error.name === "NotAllowedError" || error.name === "AbortError")
      ) {
        formError = "Cancelled, so it stays off.";
      } else {
        formError = "Couldn't turn it on. Try again.";
      }
    } finally {
      busy = false;
      password = "";
    }
  }

  /**
   * Another tab's change shows here too, as it counts here too.
   *
   * @param {StorageEvent} event
   */
  function followOtherTabs(event) {
    if (event.storageArea === localStorage) {
      isOn = Boolean(vault.passkey());
    }
  }
</script>

<svelte:window on:storage={followOtherTabs} />

{#if isOn || canOffer}
  <label
    class="settings-group__control settings-group__control--switch"
    for={undefined}
  >
    <span>Unlock with fingerprint or face</span>
    <Switch
      aria-label="Unlock with fingerprint or face"
      disabled={busy}
      on:change={(event) => turn(event.detail)}
      value={isOn || isEditing}
    />
  </label>
  {#if isEditing}
    <form class="passkey-setting" novalidate on:submit|preventDefault={turnOn}>
      <UnlockPasswordField
        bind:error={passwordError}
        bind:value={password}
        disabled={busy}
      />
      {#if formError}
        <p class="passkey-setting__error" role="alert">{formError}</p>
      {/if}
      <div class="settings-group__buttons">
        <Button
          disabled={busy}
          text={busy ? "Waiting for your device…" : "Turn on"}
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
  {:else if isOn}
    <p class="settings-group__note">
      On this device only. Your password keeps working, and big sends still ask
      for it.
    </p>
  {/if}
{:else if cantHere}
  <p class="settings-group__note" role="status">
    This device or browser can't do fingerprint or face unlock, so it stays off.
  </p>
{/if}

<style lang="postcss">
  .passkey-setting {
    display: flex;
    flex-direction: column;
    gap: var(--default-gap);
  }

  .passkey-setting__error {
    color: var(--calm-danger);
    font-size: 0.875rem;
    line-height: 1.4;
  }
</style>
