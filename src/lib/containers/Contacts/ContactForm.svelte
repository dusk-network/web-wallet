<script>
  import { createEventDispatcher, onMount } from "svelte";
  import { mdiClose, mdiInformationOutline } from "@mdi/js";
  import { Button, Icon, Textbox } from "$lib/dusk/components";
  import { FullAddress } from "$lib/components";
  import { addressType, findContact, saveContact } from "$lib/contacts";
  import { isDuskName } from "$lib/dusk-domains";

  /**
   * The contact changed, or null for a new one.
   *
   * @type {Contact | null}
   */
  export let contact = null;

  /** @type {(name: string) => Promise<DuskNameResolution>} */
  export let resolveName;

  const dispatch = createEventDispatcher();

  let name = contact?.name ?? "";

  /** The address or `.dusk` name entered. */
  let recipient = contact?.duskName ?? contact?.address ?? "";

  /**
   * The `.dusk` name looked up, and what it resolved to once it has.
   *
   * @type {{ name: string, result?: DuskNameResolution } | null}
   */
  let lookup = null;

  /** @type {"account" | "address"} */
  let kind = contact?.type === "address" ? "address" : "account";

  /** Whether "Delete" was asked once, to ask again before it deletes. */
  let isDeleting = false;

  /** @type {HTMLElement} */
  let form;

  /**
   * Looks a `.dusk` name up, keeping only the answer for the name entered.
   *
   * @param {string} value
   */
  function lookUp(value) {
    if (!isDuskName(value)) {
      lookup = null;
      return;
    }

    const asked = { name: value };

    lookup = asked;
    resolveName(value).then((result) => {
      if (lookup === asked) {
        lookup = { name: value, result };
      }
    });
  }

  function save() {
    const saved = saveContact({
      address,
      checkedAt: duskName ? Date.now() : null,
      duskName: duskName || null,
      id: contact?.id,
      name,
    });

    dispatch("saved", saved);
  }

  $: entered = recipient.replace(/\s+/g, "");
  $: duskName = isDuskName(entered) ? entered.toLowerCase() : "";
  $: lookUp(entered);
  $: resolution = lookup?.result ?? null;
  $: options =
    resolution && !resolution.error
      ? /** @type {const} */ (["account", "address"]).filter(
          (type) => resolution?.[type]
        )
      : [];
  $: if (options.length && !options.includes(kind)) {
    kind = options[0];
  }
  $: address = duskName ? (resolution?.[kind] ?? "") : entered;
  $: isValid = name.trim() !== "" && addressType(address) !== "unknown";
  $: other = address ? findContact(address) : null;
  $: isTaken = other !== null && other.id !== contact?.id;

  // Saving a contact again with its `.dusk` name takes the address the name
  // points to now: said, when it isn't the one saved.
  $: isReplacing = Boolean(
    contact && address && duskName && address !== contact.address
  );

  onMount(() => {
    form?.querySelector("input")?.focus();
  });
</script>

<aside
  aria-labelledby="contact-form-title"
  class="contact-form"
  bind:this={form}
>
  <header class="contact-form__header">
    <h2 id="contact-form-title">{contact ? "Edit contact" : "New contact"}</h2>
    <button
      aria-label="Close without saving"
      class="contact-form__close"
      on:click={() => dispatch("cancel")}
      type="button"
    >
      <Icon path={mdiClose} />
    </button>
  </header>

  <form
    class="contact-form__fields"
    on:submit|preventDefault={() => {
      if (isValid && !isTaken) {
        save();
      }
    }}
  >
    <label class="contact-form__label">
      Name
      <Textbox bind:value={name} maxlength={40} required type="text" />
    </label>

    <label class="contact-form__label">
      Address or .dusk name
      <Textbox bind:value={recipient} required type="text" />
    </label>

    {#if duskName}
      {#if resolution && !resolution.error && options.length}
        <div class="contact-form__card">
          <p class="contact-form__points">
            <strong>{duskName}</strong> points to {options.length > 1
              ? "a public account and a shielded address"
              : kind === "address"
                ? "a shielded address"
                : "a public account"}
          </p>
          {#if options.length > 1}
            <div
              aria-label="Save"
              class="contact-form__kinds"
              role="radiogroup"
            >
              {#each options as option (option)}
                <label class="contact-form__kind">
                  <input
                    bind:group={kind}
                    name="kind"
                    type="radio"
                    value={option}
                  />
                  {option === "address" ? "Shielded address" : "Public account"}
                </label>
              {/each}
            </div>
          {/if}
          <p><FullAddress {address} /></p>
        </div>
        {#if isReplacing}
          <p class="contact-form__warning" role="alert">
            This isn't the address saved for {contact?.name}. Saving replaces
            it.
          </p>
        {/if}
        <p class="contact-form__info">
          <Icon path={mdiInformationOutline} />
          The contact keeps this address. If {duskName} later points somewhere else,
          Send asks before it uses the new one.
        </p>
      {:else if resolution?.error}
        <p class="contact-form__error" role="alert">
          {resolution.error === "not-registered"
            ? `${duskName} isn't registered.`
            : resolution.error === "lookup-failed"
              ? `Couldn't look up ${duskName}. Check your connection.`
              : `${duskName} has no address to save.`}
        </p>
      {:else}
        <p class="contact-form__info">Looking up {duskName}…</p>
      {/if}
    {:else if entered && addressType(entered) === "unknown"}
      <p class="contact-form__error" role="alert">Not a valid address.</p>
    {/if}

    {#if isTaken && other}
      <p class="contact-form__error" role="alert">
        This address is already saved as {other.name}.
      </p>
    {/if}

    <div class="contact-form__buttons">
      {#if contact}
        {#if isDeleting}
          <Button
            on:click={() => dispatch("delete", contact)}
            text="Delete {contact.name}"
            variant="secondary"
          />
        {:else}
          <Button
            on:click={() => {
              isDeleting = true;
            }}
            text="Delete contact"
            variant="tertiary"
          />
        {/if}
      {/if}
      <span class="contact-form__spacer"></span>
      <Button
        on:click={() => dispatch("cancel")}
        text="Cancel"
        variant="secondary"
      />
      <Button
        disabled={!isValid || isTaken}
        text="Save contact"
        type="submit"
        variant="primary"
      />
    </div>
  </form>
</aside>

<style lang="postcss">
  .contact-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
    padding: 1.5rem;
    background: var(--calm-panel);
  }

  .contact-form__header {
    display: flex;
    align-items: center;
    justify-content: space-between;

    & h2 {
      font-size: 1.25rem;
      font-weight: 500;
    }
  }

  .contact-form__close {
    all: unset;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    color: var(--calm-muted);
    cursor: pointer;

    &:hover {
      color: var(--calm-text);
    }

    &:focus-visible {
      outline: 2px solid var(--calm-focus);
    }
  }

  .contact-form__fields {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .contact-form__label {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    color: var(--calm-muted);
    font-size: 0.875rem;
  }

  .contact-form__card {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.875rem 1rem;
    border-radius: 0.75rem;
    background: var(--calm-s1);
    font-size: 0.875rem;
  }

  .contact-form__kinds {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .contact-form__kind {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    min-height: 44px;
  }

  .contact-form__info {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    color: var(--calm-text);
    font-size: 0.84375rem;

    & :global(.dusk-icon) {
      flex: 0 0 auto;
      width: 1rem;
      height: 1rem;
      margin-top: 0.125rem;
    }
  }

  .contact-form__error {
    color: var(--calm-danger);
    font-size: 0.875rem;
  }

  .contact-form__warning {
    padding: 0.625rem 0.875rem;
    border: 1px solid var(--calm-pending);
    border-radius: 0.75rem;
    font-size: 0.875rem;
  }

  .contact-form__buttons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.625rem;
  }

  .contact-form__spacer {
    flex: 1;
  }
</style>
