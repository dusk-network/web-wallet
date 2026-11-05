import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { tick } from "svelte";

import { ScanQR } from "..";

// A camera, and what it does when it's asked to start.
const qr = vi.hoisted(() => ({
  /** @type {(result: { data: string }) => void} */
  read: () => {},
  start: vi.fn(() => Promise.resolve()),
}));

vi.mock("qr-scanner", () => ({
  default: class {
    static hasCamera = () => Promise.resolve(true);

    start = qr.start;

    /**
     * @param {HTMLVideoElement} _video
     * @param {(result: { data: string }) => void} onDecode
     */
    constructor(_video, onDecode) {
      qr.read = onDecode;
    }

    destroy() {}

    stop() {}
  },
}));

describe("ScanQR", () => {
  const baseProps = {
    scanner: undefined,
  };

  const baseOptions = {
    props: baseProps,
    target: document.body,
  };

  /** A scanner whose camera was found. */
  async function withCamera() {
    const view = render(ScanQR, baseOptions);

    await vi.waitFor(() =>
      expect(view.component.startScan).toBeInstanceOf(Function)
    );
    await Promise.resolve();
    await tick();

    return view;
  }

  afterEach(() => {
    cleanup();
    qr.start.mockClear();
  });

  it("renders the ScanQR component", () => {
    const { container } = render(ScanQR, baseOptions);

    expect(container.firstElementChild).toBeInTheDocument();
  });

  it("says so when the camera can't start, and starts it again as it's asked to", async () => {
    const { component, findByRole, getByRole, queryByRole } =
      await withCamera();

    qr.start.mockRejectedValueOnce(new Error("Camera not found."));
    await component.startScan();

    expect(await findByRole("alert")).toHaveTextContent(
      "Couldn't start the camera."
    );

    await component.startScan();
    await tick();

    expect(queryByRole("alert")).toBeNull();
    expect(qr.start).toHaveBeenCalledTimes(2);
    expect(getByRole("group", { name: "Scan a QR code" })).toBeInTheDocument();
  });

  it("gives what it reads once, whatever else the camera reads as it closes", async () => {
    const scan = vi.fn();
    const { component } = render(ScanQR, {
      ...baseOptions,
      events: { scan },
    });

    await vi.waitFor(async () => {
      await component.startScan();
      expect(qr.start).toHaveBeenCalled();
    });

    qr.read({ data: "dusk:public-abc" });
    qr.read({ data: "dusk:public-abc" });

    expect(scan).toHaveBeenCalledOnce();
    expect(scan.mock.lastCall?.[0].detail).toBe("dusk:public-abc");
  });
});
