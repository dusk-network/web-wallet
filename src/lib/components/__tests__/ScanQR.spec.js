import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";

import { ScanQR } from "..";

// A camera, and what it does when it's asked to start.
const qr = vi.hoisted(() => ({
  camera: true,

  /** @type {Record<string, any>} */
  options: {},

  /** @type {(result: { data: string }) => void} */
  read: () => {},

  /** What an image chosen holds, as the scanner reads it. */
  scanImage: vi.fn(),
  start: vi.fn(() => Promise.resolve()),
}));

vi.mock("qr-scanner", () => ({
  default: class {
    static hasCamera = () => Promise.resolve(qr.camera);

    static scanImage = qr.scanImage;

    start = qr.start;

    /**
     * @param {HTMLVideoElement} _video
     * @param {(result: { data: string }) => void} onDecode
     * @param {Record<string, any>} options
     */
    constructor(_video, onDecode, options) {
      qr.read = onDecode;
      qr.options = options;
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

  /**
   * A scanner whose camera was found, or found missing.
   *
   * @param {Record<string, any>} [events]
   */
  async function ready(events = {}) {
    const view = render(ScanQR, { ...baseOptions, events });

    await vi.waitFor(() =>
      expect(view.component.startScan).toBeInstanceOf(Function)
    );
    await Promise.resolve();
    await tick();

    return view;
  }

  afterEach(() => {
    cleanup();
    qr.camera = true;
    qr.start.mockClear();
    qr.scanImage.mockReset();
  });

  it("renders the ScanQR component", () => {
    const { container } = render(ScanQR, baseOptions);

    expect(container.firstElementChild).toBeInTheDocument();
  });

  it("reads the camera's whole frame, made smaller, for a code that fills the view", async () => {
    await ready();

    expect(
      qr.options.calculateScanRegion({ videoHeight: 480, videoWidth: 640 })
    ).toStrictEqual({
      downScaledHeight: 480,
      downScaledWidth: 640,
      height: 480,
      width: 640,
      x: 0,
      y: 0,
    });
    expect(
      qr.options.calculateScanRegion({ videoHeight: 1080, videoWidth: 1920 })
    ).toStrictEqual({
      downScaledHeight: 450,
      downScaledWidth: 800,
      height: 1080,
      width: 1920,
      x: 0,
      y: 0,
    });
  });

  it("says so when the camera can't start, and starts it again as it's asked to", async () => {
    const { component, findByRole, getByRole, queryByRole } = await ready();

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

  it("says what's wrong with a code it doesn't take, and reads on", async () => {
    const scan = vi.fn();
    const check = (/** @type {string} */ text) =>
      text.startsWith("dusk:") ? "" : "That QR isn't a Dusk address.";
    const view = render(ScanQR, {
      ...baseOptions,
      events: { scan },
      props: { ...baseProps, check },
    });

    await vi.waitFor(async () => {
      await view.component.startScan();
      expect(qr.start).toHaveBeenCalled();
    });

    qr.read({ data: "hello from the canteen menu" });
    await tick();

    expect(scan).not.toHaveBeenCalled();
    expect(view.getByRole("alert")).toHaveTextContent(
      "That QR isn't a Dusk address."
    );

    qr.read({ data: "dusk:public-abc" });

    expect(scan).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ detail: "dusk:public-abc" })
    );
  });

  it("reads a code from an image chosen, the way in where there's no camera, and says when one holds none", async () => {
    qr.camera = false;

    const scan = vi.fn();
    const click = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    const view = await ready({ scan });

    await view.component.startScan();

    // No camera: the file picker opens at once, as the press asked for it.
    expect(click).toHaveBeenCalledOnce();
    expect(view.getByText("Choose an image of a QR code.")).toBeInTheDocument();

    const input = /** @type {HTMLInputElement} */ (
      view.getByLabelText("Image of a QR code")
    );
    const image = new File(["png"], "request.png", { type: "image/png" });

    qr.scanImage.mockRejectedValueOnce("No QR code found");
    await fireEvent.change(input, { target: { files: [image] } });

    expect(await view.findByRole("alert")).toHaveTextContent(
      "No QR code found in that image."
    );

    qr.scanImage.mockResolvedValueOnce({ data: "dusk:public-abc" });
    await fireEvent.change(input, { target: { files: [image] } });

    await vi.waitFor(() =>
      expect(scan).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ detail: "dusk:public-abc" })
      )
    );
    expect(qr.scanImage).toHaveBeenLastCalledWith(image, {
      returnDetailedScanResult: true,
    });

    click.mockRestore();
  });

  it("drops what an image read gives once the scanner was closed meanwhile", async () => {
    qr.camera = false;

    const scan = vi.fn();
    const click = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    const view = await ready({ scan });

    await view.component.startScan();

    /** @type {(value: { data: string }) => void} */
    let read = () => {};

    qr.scanImage.mockReturnValueOnce(
      new Promise((resolve) => {
        read = resolve;
      })
    );
    await fireEvent.change(view.getByLabelText("Image of a QR code"), {
      target: {
        files: [new File(["png"], "request.png", { type: "image/png" })],
      },
    });
    await fireEvent.click(view.getByRole("button", { name: "Close" }));
    read({ data: "dusk:public-abc" });
    await tick();
    await Promise.resolve();

    expect(scan).not.toHaveBeenCalled();

    click.mockRestore();
  });
});
