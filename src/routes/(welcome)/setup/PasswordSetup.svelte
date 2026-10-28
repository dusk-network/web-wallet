<script>
  import { mdiKeyOutline } from "@mdi/js";
  import { Textbox } from "$lib/dusk/components";
  import { randomUUID } from "$lib/dusk/string";
  import { ToggleableCard } from "$lib/containers/Cards";
  import { Banner } from "$lib/components";
  import { getPasswordStrength } from "$lib/wallet";

  /** @type {string} */
  export let password = "";

  /** @type {boolean} */
  export let isValid = false;

  /** @type {boolean} */
  export let isToggled = true;

  /** @type {string} */
  let confirmPassword = "";

  const strengthId = `${randomUUID()}-password-strength`;

  /** @type {Record<ReturnType<typeof getPasswordStrength>, string>} */
  const strengthHints = {
    fair: "Fair password. Longer is safer.",
    strong: "Strong password.",
    weak: "Weak password: easy to guess. Make it longer, or use a few unrelated words.",
  };

  // A hint at how hard the password is to guess, once it is long enough.
  $: strength = password.length >= 8 ? getPasswordStrength(password) : null;

  $: isValid =
    !isToggled ||
    (password.length >= 8 &&
      confirmPassword.length >= 8 &&
      password === confirmPassword);

  $: if (isToggled) {
    password = "";
    confirmPassword = "";
  }
</script>

<ToggleableCard heading="Password" iconPath={mdiKeyOutline} bind:isToggled>
  <p>Please store your password safely.</p>
  <Textbox
    aria-describedby={strength ? strengthId : undefined}
    className="password-input"
    type="password"
    autocomplete="new-password"
    bind:value={password}
    placeholder="Set Password"
  />
  {#if strength}
    <p
      class="password-strength"
      class:password-strength--weak={strength === "weak"}
      id={strengthId}
    >
      {strengthHints[strength]}
    </p>
  {/if}
  <div class="confirm-password">
    <Textbox
      className="password-input"
      type="password"
      autocomplete="new-password"
      bind:value={confirmPassword}
      placeholder="Confirm Password"
    />
    {#if password.length < 8}
      <span class="confirm-password--meta"
        >Password must be at least 8 characters</span
      >
    {:else if confirmPassword && password !== confirmPassword}
      <span
        class="confirm-password--meta
						confirm-password--meta--error">Passwords do not match</span
      >
    {/if}
  </div>
</ToggleableCard>

<Banner
  title="Setting a password for your web wallet is recommended."
  variant="info"
>
  <p>
    Without a password, you need to enter your full recovery phrase each time
    you open the wallet, which could expose it.
  </p>
</Banner>

<style lang="postcss">
  .confirm-password {
    &--meta {
      display: inline-block;
      font-size: 0.75em;
      margin-top: 0.8em;
      margin-left: 1em;
      opacity: 0.5;

      &--error {
        color: var(--error-color);
        opacity: 1;
      }
    }
  }

  .password-strength {
    font-size: 0.75em;
    margin: 0.8em 0 0 1em;
    opacity: 0.5;

    &--weak {
      color: var(--banner-warning-color);
      opacity: 1;
    }
  }

  :global(.password-input) {
    display: flex;
    margin-top: 1em;
    width: 100%;
  }
</style>
