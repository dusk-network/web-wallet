import { readFileSync } from "node:fs";
import { parse } from "svelte/compiler";

/**
 * @typedef {{ declarations: Record<string, string>, media: string, selector: string }} StyleRule
 */

/**
 * A component's style rules, as written: each one's selector and
 * declarations, and the media query it sits in ("" for none).
 *
 * @param {string} file The component, or its style sheet, from `base`
 * @param {string} base The test's `import.meta.url`
 * @returns {StyleRule[]}
 */
export default function styleRules(file, base) {
  const text = readFileSync(new URL(file, base), "utf8");
  const source = file.endsWith(".css") ? `<style>${text}</style>` : text;
  const { css } = parse(source, { modern: true });
  /** @type {StyleRule[]} */
  const rules = [];

  /**
   * @param {any[]} nodes
   * @param {string} media
   */
  const walk = (nodes, media) => {
    for (const node of nodes) {
      if (node.type === "Atrule" && node.name === "media") {
        walk(node.block.children, node.prelude);
      } else if (node.type === "Rule") {
        rules.push({
          declarations: Object.fromEntries(
            node.block.children
              .filter(
                (/** @type {any} */ child) => child.type === "Declaration"
              )
              .map((/** @type {any} */ child) => [child.property, child.value])
          ),
          media,
          selector: source.slice(node.prelude.start, node.prelude.end),
        });
        walk(node.block.children, media);
      }
    }
  };

  walk(css?.children ?? [], "");

  return rules;
}
