export default class MediaQueryListEvent extends Event {
  #matches;

  #media;

  /**
   * @param {string} type
   * @param {MediaQueryListEventInit} options
   */
  constructor(type, options) {
    super(type, {
      bubbles: options.bubbles,
      cancelable: options.cancelable,
      composed: options.composed,
    });

    this.#matches = options.matches;
    this.#media = options.media;
  }

  get matches() {
    return this.#matches;
  }

  get media() {
    return this.#media;
  }
}
