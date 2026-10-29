import { afterEach, describe, expect, it, vi } from "vitest";

import viteConfig from "../../vite.config.js";

describe("vite.config.js", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should key what the wallet keeps in the browser by the package's name, also when npm doesn't run Vite", async () => {
    vi.stubEnv("npm_package_name", undefined);

    const { define, plugins } = viteConfig({
      command: "build",
      mode: "production",
    });

    await Promise.all(plugins ?? []);

    expect(define?.CONFIG).toStrictEqual({
      LOCAL_STORAGE_APP_KEY: "web-wallet",
    });
  });
});
