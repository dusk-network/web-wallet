/**
 * An error's message, or the value as text when it's no Error.
 *
 * @param {unknown} value
 */
const errorMessage = (value) =>
  value instanceof Error ? value.message : String(value);

export default errorMessage;
