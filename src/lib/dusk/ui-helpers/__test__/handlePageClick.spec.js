import { describe, expect, it, vi } from "vitest";
import { handlePageClick } from "../handlePageClick";

describe("handlePageClick", () => {
  it("calls callback on click outside the node", () => {
    const node = document.createElement("div");
    const callback = vi.fn();

    document.body.appendChild(node);

    handlePageClick(node, { callback, enabled: true });

    document.body.click();
    expect(callback).toHaveBeenCalledTimes(1);

    document.body.removeChild(node);
  });

  it("does not call callback on click inside the node", () => {
    const node = document.createElement("div");
    const callback = vi.fn();

    document.body.appendChild(node);

    handlePageClick(node, { callback, enabled: true });

    node.click();
    expect(callback).toHaveBeenCalledTimes(0);

    document.body.removeChild(node);
  });

  it("toggles listener activation based on enabled property", () => {
    const node = document.createElement("div");
    const callback = vi.fn();

    document.body.appendChild(node);

    const action = handlePageClick(node, { callback, enabled: false });

    document.body.click();
    expect(callback).toHaveBeenCalledTimes(0);

    action.update({ enabled: true });

    document.body.click();
    expect(callback).toHaveBeenCalledTimes(1);

    document.body.removeChild(node);
  });

  it("removes event listener on destroy", () => {
    const node = document.createElement("div");
    const callback = vi.fn();

    document.body.appendChild(node);

    const action = handlePageClick(node, { callback, enabled: true });

    action.destroy();

    document.body.click();
    expect(callback).toHaveBeenCalledTimes(0);

    document.body.removeChild(node);
  });

  it("should keep an outside click from what's under it when told to, and only then", () => {
    const callback = vi.fn();
    const underneath = vi.fn();
    const node = document.createElement("div");
    const outside = document.createElement("button");

    outside.addEventListener("click", underneath);
    document.body.append(node, outside);

    const action = handlePageClick(node, {
      callback,
      enabled: true,
      swallow: true,
    });

    outside.click();

    expect(callback).toHaveBeenCalledOnce();
    expect(underneath).not.toHaveBeenCalled();

    action.destroy();
    outside.click();

    expect(callback).toHaveBeenCalledOnce();
    expect(underneath).toHaveBeenCalledOnce();

    const plain = handlePageClick(node, { callback, enabled: true });

    outside.click();

    expect(callback).toHaveBeenCalledTimes(2);
    expect(underneath).toHaveBeenCalledTimes(2);

    plain.destroy();
    node.remove();
    outside.remove();
  });
});
