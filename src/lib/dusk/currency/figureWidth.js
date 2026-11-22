/** Any digit, a sign, or the dot of a hidden balance: a tabular digit's width. */
const WIDE = /[\p{Nd}+\-−•]/u;

/**
 * At most how wide an amount as the wallet writes it is, in em of its own
 * type with tabular digits: a digit, a sign or a hidden balance's dot is
 * 0.62 em at most, a separator 0.25 em, a little over what the wallet's
 * fonts give them. A number too long for its line is set smaller by it, so
 * that it shows whole on one line, never broken or cut.
 *
 * @param {string} text An amount, formatted
 * @returns {number}
 */
const figureWidth = (text) =>
  [...text].reduce((width, char) => width + (WIDE.test(char) ? 0.62 : 0.25), 0);

export default figureWidth;
