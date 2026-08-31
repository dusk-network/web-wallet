<svelte:options immutable={true} />

<script>
  /** @type {(value: any) => value is string} */
  const isString = (value) => typeof value === "string";

  /** @type SelectOption[] | string[] */
  export let options;
</script>

{#each options as option (isString(option) ? option : option.value)}
  <option
    disabled={isString(option) ? false : option.disabled}
    value={isString(option) ? option : option.value}
  >
    {isString(option) ? option : (option.label ?? option.value)}
  </option>
{/each}
