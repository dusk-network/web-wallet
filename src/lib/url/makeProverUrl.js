/**
 * Constructs a prover URL based on the current subdomain
 *
 * @param {string} path
 * @returns {URL} proverUrl
 */
function makeProverUrl(path = "") {
  if (path !== "" && !path.startsWith("/")) {
    throw new Error("A path must start with a '/'.");
  }

  const subDomains = window.location.hostname.split(".");
  const hostedNodeDomain = subDomains.slice(-2).join(".");
  const proverBaseUrl = import.meta.env.VITE_PROVER_URL
    ? import.meta.env.VITE_PROVER_URL.replace(/\/+$/, "")
    : "";

  /**
   * @param {string} base
   * @returns {URL}
   */
  const buildHostedProverUrl = (base) =>
    new URL(`${window.location.protocol}${base}${hostedNodeDomain}${path}`);

  let proverUrl;

  switch (`${subDomains[0]}.${subDomains[1]}.${subDomains[2]}`) {
    case "apps.dusk.network":
    case "apps.staging.dusk":
      proverUrl = buildHostedProverUrl("provers.");
      break;
    case "apps.devnet.dusk":
    case "apps.staging.devnet":
      proverUrl = buildHostedProverUrl("devnet.provers.");
      break;
    case "apps.testnet.dusk":
    case "apps.staging.testnet":
      proverUrl = buildHostedProverUrl("testnet.provers.");
      break;
    default:
      if (proverBaseUrl) {
        proverUrl = new URL(`${proverBaseUrl}${path}`);
      } else {
        const locationHost = window.location.port
          ? `${window.location.hostname}:${window.location.port}`
          : window.location.hostname;
        const fallbackBase = `${window.location.protocol}//${locationHost}`;

        proverUrl = new URL(path || "/", fallbackBase);
      }
      break;
  }

  return proverUrl;
}

export default makeProverUrl;
