/** How many bytes go to `String.fromCharCode` at once: far below any engine's limit on arguments. */
const CHUNK = 0x8000;

/** @type {(bytes: Uint8Array) => string} */
function bytesToBase64(bytes) {
  let text = "";

  for (let i = 0; i < bytes.length; i += CHUNK) {
    text += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }

  return btoa(text);
}

export default bytesToBase64;
