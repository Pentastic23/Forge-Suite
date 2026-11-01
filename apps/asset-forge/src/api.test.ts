import { describe, expect, it } from "vitest";
import { dims, duration, previewKind, size } from "./api";

describe("formatting", () => {
  it("sizes", () => {
    expect(size(512)).toBe("512 B");
    expect(size(2_400)).toBe("2 KB");
    expect(size(3_250_000)).toBe("3.3 MB");
    expect(size(1_500_000_000)).toBe("1.5 GB");
  });
  it("durations", () => {
    expect(duration(860)).toBe("0.9s");
    expect(duration(12_400)).toBe("12s");
    expect(duration(95_000)).toBe("1:35");
  });
  it("dimensions only when known", () => {
    expect(dims({ width: 32, height: 16 })).toBe("32×16");
    expect(dims({ width: null, height: null })).toBe("");
  });
});

describe("previewKind", () => {
  it("sorts by extension, ignoring case", () => {
    expect(previewKind({ ext: "PNG", missing: false })).toBe("image");
    expect(previewKind({ ext: "ogg", missing: false })).toBe("audio");
    expect(previewKind({ ext: "webm", missing: false })).toBe("video");
    expect(previewKind({ ext: "fbx", missing: false })).toBeNull();
  });
  it("never previews a missing file", () => {
    expect(previewKind({ ext: "png", missing: true })).toBeNull();
  });
});
