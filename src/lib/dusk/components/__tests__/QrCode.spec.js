import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { QrCode } from "..";

const mockBase64Value = vi.hoisted(
  () =>
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg=="
);
const toDataUrlMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(mockBase64Value)
);

vi.mock("qrcode", async (importOriginal) => ({
  ...(await importOriginal()),
  toDataURL: toDataUrlMock,
}));

describe("QrCode", () => {
  const defaultSize = 200;
  const baseProps = {
    value: "some text",
  };
  const baseOptions = {
    props: baseProps,
    target: document.body,
  };

  afterEach(() => {
    cleanup();
    toDataUrlMock.mockClear();
  });

  afterAll(() => {
    toDataUrlMock.mockRestore();
  });

  it("should render the QrCode component and update it when any of the prop change", async () => {
    const { container, getByRole, rerender } = render(QrCode, baseOptions);
    const placeholderElement = container.firstElementChild;

    expect(placeholderElement?.nodeName.toLowerCase()).toBe("div");
    expect(placeholderElement).toHaveStyle({
      height: `${defaultSize}px`,
      width: `${defaultSize}px`,
    });

    await vi.waitFor(() => expect(placeholderElement).not.toBeInTheDocument());

    let imgElement = getByRole("img");

    expect(imgElement).toHaveAttribute("height", defaultSize.toString());
    expect(imgElement).toHaveAttribute("width", defaultSize.toString());
    expect(imgElement).toHaveAttribute("src", mockBase64Value);
    expect(container.firstElementChild).toMatchSnapshot();
    expect(toDataUrlMock).toHaveBeenCalledTimes(1);
    expect(toDataUrlMock).toHaveBeenNthCalledWith(1, baseProps.value, {
      color: {
        dark: expect.any(String),
        light: expect.any(String),
      },
      width: defaultSize,
    });

    await rerender({ value: "some different text" });

    expect(toDataUrlMock).toHaveBeenCalledTimes(2);
    expect(toDataUrlMock).toHaveBeenNthCalledWith(2, "some different text", {
      color: {
        dark: expect.any(String),
        light: expect.any(String),
      },
      width: defaultSize,
    });

    await rerender({ bgColor: "#000" });

    expect(toDataUrlMock).toHaveBeenCalledTimes(3);
    expect(toDataUrlMock).toHaveBeenNthCalledWith(3, "some different text", {
      color: {
        dark: expect.any(String),
        light: "#000",
      },
      width: defaultSize,
    });

    await rerender({ qrColor: "#fff" });

    expect(toDataUrlMock).toHaveBeenCalledTimes(4);
    expect(toDataUrlMock).toHaveBeenNthCalledWith(4, "some different text", {
      color: {
        dark: "#fff",
        light: "#000",
      },
      width: defaultSize,
    });

    await rerender({ width: 500 });

    imgElement = getByRole("img");

    expect(imgElement).toHaveAttribute("height", "500");
    expect(imgElement).toHaveAttribute("width", "500");
    expect(toDataUrlMock).toHaveBeenCalledTimes(5);
    expect(toDataUrlMock).toHaveBeenNthCalledWith(5, "some different text", {
      color: {
        dark: "#fff",
        light: "#000",
      },
      width: 500,
    });
  });
});
