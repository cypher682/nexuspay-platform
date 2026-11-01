import { csvCell, toCsv } from "../src/lib/csv";

describe("csv", () => {
  it("quotes cells containing commas, quotes or newlines", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });

  it("renders a header plus one line per row", () => {
    const csv = toCsv([
      {
        day: "2026-10-31",
        currency: "NGN",
        succeededCount: 2,
        failedCount: 1,
        refundedCount: 0,
        grossVolumeMinor: "150000",
        refundedVolumeMinor: "0"
      }
    ]);
    const lines = csv.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      "day,currency,succeededCount,failedCount,refundedCount,grossVolumeMinor,refundedVolumeMinor"
    );
    expect(lines[1]).toBe("2026-10-31,NGN,2,1,0,150000,0");
  });
});
