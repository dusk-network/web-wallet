import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "svelte/compiler";

import styleRules from "$lib/dusk/test-helpers/styleRules";

const SRC = `${process.cwd()}/src/`;

/**
 * The app's Svelte files, as paths from `src/`: not the tests, nor the
 * components' showcase.
 *
 * @param {string} [dir]
 * @returns {string[]}
 */
const svelteFiles = (dir = "") =>
  readdirSync(`${SRC}${dir}`, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}${entry.name}`;

    if (entry.isDirectory()) {
      return /^(__tests__|components-showcase)$/.test(entry.name)
        ? []
        : svelteFiles(`${path}/`);
    }

    return entry.name.endsWith(".svelte") ? [path] : [];
  });

/**
 * The fields a file draws with its own elements: inputs typed in, as
 * `input[type]` ("{…}" for a type set from a value), selects and textareas.
 *
 * @param {string} file
 * @returns {string[]}
 */
function ownFields(file) {
  const { fragment } = parse(readFileSync(`${SRC}${file}`, "utf8"), {
    modern: true,
  });
  /** @type {string[]} */
  const fields = [];

  /** @param {any} node */
  const walk = (node) => {
    if (!node || typeof node !== "object") {
      return;
    }

    if (Array.isArray(node)) {
      node.forEach(walk);

      return;
    }

    if (
      node.type === "RegularElement" &&
      ["input", "select", "textarea"].includes(node.name)
    ) {
      const type = node.attributes.find(
        (/** @type {any} */ a) => a.type === "Attribute" && a.name === "type"
      );
      const kind =
        type === undefined
          ? "text"
          : Array.isArray(type.value)
            ? type.value.map((/** @type {any} */ v) => v.data ?? "").join("")
            : "{…}";

      if (node.name !== "input") {
        fields.push(node.name);
      } else if (!["checkbox", "hidden", "radio"].includes(kind)) {
        fields.push(`input[${kind}]`);
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (key !== "metadata") {
        walk(value);
      }
    }
  };

  walk(fragment);

  return fields;
}

/**
 * A style rule's declarations, by its selector as written.
 *
 * @param {string} file From this folder
 * @param {string} selector
 */
const ruleOf = (file, selector) =>
  styleRules(file, import.meta.url).find(
    (rule) => rule.selector === selector && rule.media === ""
  )?.declarations ?? {};

/** @param {string} color A hex colour: #rgb or #rrggbb */
function luminance(color) {
  const hex =
    color.length === 4 ? color.replace(/\w/g, (digit) => digit + digit) : color;
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;

    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * @param {string} a
 * @param {string} b
 */
function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return (light + 0.05) / (dark + 0.05);
}

describe("Fields", () => {
  it("are the shared Textbox and Select everywhere, but where a field of its own wraps the input", () => {
    const drawn = Object.fromEntries(
      svelteFiles().flatMap((file) => {
        const fields = ownFields(file);

        return fields.length ? [[file, fields]] : [];
      })
    );

    expect(drawn).toStrictEqual({
      // The shared ones.
      "lib/dusk/components/Select/Select.svelte": ["select"],
      "lib/dusk/components/Textbox/Textbox.svelte": ["textarea", "input[{…}]"],

      // In a field's panel: the Bridge card's amounts.
      "lib/components/Bridge/Bridge.svelte": ["input[text]"],
      "lib/components/Bridge/MigrationRoute.svelte": ["input[text]"],
      "lib/components/Bridge/ServiceRoute.svelte": ["input[text]"],

      // Each word of a recovery phrase in a field of its own.
      "lib/components/MnemonicInput/MnemonicInput.svelte": ["input[text]"],

      // The scanner's image of a code, chosen in the browser's own picker.
      "lib/components/ScanQR/ScanQR.svelte": ["input[file]"],

      // Send's contact picker, compact.
      "lib/components/Send/Send.svelte": ["select"],

      // Contacts' search, in a field's box.
      "lib/containers/Contacts/ContactsView.svelte": ["input[search]"],

      // The search's own field: the first row of its dialog.
      "lib/containers/Shell/CommandBar.svelte": ["input[text]"],
    });
  });

  it("have an edge that reads 3:1 or more on every surface, in light and dark", () => {
    const tokens = (/** @type {string} */ selector) =>
      ruleOf("../../../style/duskit-bridge.css", selector);

    for (const theme of [tokens(":root"), tokens(":root.dark")]) {
      const edge = theme["--calm-field-edge"];

      for (const surface of [
        "--calm-s0",
        "--calm-s1",
        "--calm-s2",
        "--calm-s3",
        "--calm-panel",
        "--calm-field",
      ]) {
        expect(
          contrast(edge, theme[surface]),
          `${edge} on ${surface}`
        ).toBeGreaterThanOrEqual(3);
      }
    }

    // The shared fields, and those of their own, all have that edge.
    const edges = [
      ruleOf("../../../style/dusk-components/textbox.css", ".dusk-textbox")[
        "border-color"
      ],
      ruleOf("../../../style/dusk-components/select.css", ".dusk-select")[
        "border-color"
      ],
      ruleOf("../MnemonicInput/MnemonicInput.svelte", ".mnemonic-input__word")
        .border,
      ruleOf("../SwapCard/SwapCard.svelte", ".swap-card :global(.swap-panel)")[
        "box-shadow"
      ],
      ruleOf("../Send/Send.svelte", ".send__contacts").border,
      ruleOf(
        "../../containers/History/HistoryView.svelte",
        "& :global(.history__select)"
      ).border,
      ruleOf(
        "../../containers/Contacts/ContactsView.svelte",
        ".contacts__search"
      ).border,
    ];

    for (const edge of edges) {
      expect(edge).toContain("var(--calm-field-edge)");
    }
  });

  it("are as tall as Send's", () => {
    expect(
      ruleOf("../../../style/dusk-components/textbox.css", ".dusk-textbox")[
        "min-height"
      ]
    ).toBe("3.25rem");
  });
});
