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
    strong: "Strong password",
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

<ToggleableCard
  heading="Use a password"
  iconPath={mdiKeyOutline}
  bind:isToggled
>
  <p>Store your password safely.</p>
  <Textbox
    aria-describedby={strength ? strengthId : undefined}
    className="password-input"
    type="password"
    autocomplete="new-password"
    bind:value={password}
    placeholder="Password"
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
      placeholder="Confirm password"
    />
    {#if password.length < 8}
      <span class="confirm-password--meta">At least 8 characters</span>
    {:else if confirmPassword && password !== confirmPassword}
      <span
        class="confirm-password--meta
						confirm-password--meta--error">Passwords don't match</span
      >
    {/if}
  </div>
</ToggleableCard>

<Banner title="A password is recommended." variant="info">
  <p>
    Without one, you type your full recovery phrase at every unlock, which could
    expose it.
  </p>
</Banner>

<style lang="postcss">
  /* Under a field, as the wallet's hints are. */
  .confirm-password {
    &--meta {
      display: block;
      margin-top: 0.5rem;
      color: var(--calm-muted);
      font-size: 0.84375rem;

      &--error {
        color: var(--calm-danger);
      }
    }
  }

  .password-strength {
    margin-top: 0.5rem;
    color: var(--calm-muted);
    font-size: 0.84375rem;

    &--weak {
      color: var(--calm-pending);
    }
  }

  :global(.password-input) {
    display: flex;
    margin-top: 1em;
    width: 100%;
  }
</style>
