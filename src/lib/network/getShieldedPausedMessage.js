/**
 * Says that shielded transactions are paused on the network
 * with the given name, as the network store has it.
 *
 * @param {string} networkName
 * @returns {string}
 */
function getShieldedPausedMessage(networkName) {
  const network =
    networkName && networkName !== "unknown"
      ? networkName.charAt(0).toUpperCase() + networkName.slice(1)
      : "this network";

  return `Shielded transactions are paused on ${network}.`;
}

export default getShieldedPausedMessage;
