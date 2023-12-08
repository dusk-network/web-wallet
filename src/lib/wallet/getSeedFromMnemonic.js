import { mnemonicToEntropy } from "@jimber/simple-bip39";
import { compose } from "lamb";

import { hexStringToBytes } from "$lib/dusk/string";

/**
 * @param {String} mnemonic
 * @returns {Uint8Array}
 */
const getSeedFromMnemonic = compose(hexStringToBytes, mnemonicToEntropy);

export default getSeedFromMnemonic;
