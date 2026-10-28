import { describe, expect, it } from "vitest";
import { parseEnvironmentUrl } from "../src/api/environment";

describe("parseEnvironmentUrl", () => {
  it.each([
    ["abc12345", "https://abc12345.live.dynatrace.com", "abc12345"],
    ["ABC12345", "https://abc12345.live.dynatrace.com", "abc12345"],
    ["https://abc12345.live.dynatrace.com/ui/hosts?gtf=-2h", "https://abc12345.live.dynatrace.com", "abc12345"],
    ["abc12345.live.dynatrace.com", "https://abc12345.live.dynatrace.com", "abc12345"],
    ["https://abc12345.apps.dynatrace.com/ui/apps/dynatrace.classic.hosts", "https://abc12345.live.dynatrace.com", "abc12345"],
    ["https://abc12345.sprint.apps.dynatracelabs.com", "https://abc12345.sprint.dynatracelabs.com", "abc12345"],
    ["https://abc12345.sprint.dynatracelabs.com/", "https://abc12345.sprint.dynatracelabs.com", "abc12345"],
    ["https://dt.example.com/e/1a2b3c4d-0000-1111/#dashboard", "https://dt.example.com/e/1a2b3c4d-0000-1111", "1a2b3c4d-0000-1111"],
    ["https://dt.example.com/e/env01/api/v2/metrics", "https://dt.example.com/e/env01", "env01"],
    ["http://localhost:8787", "http://localhost:8787", "localhost"],
    ["https://proxy.example.com/dynatrace/api/v2", "https://proxy.example.com/dynatrace", "proxy"],
  ])("%s → %s", (input, apiRoot, tenantId) => {
    expect(parseEnvironmentUrl(input)).toEqual({ apiRoot, tenantId });
  });

  it("rejects plain http to a real host", () => {
    expect(() => parseEnvironmentUrl("http://abc12345.live.dynatrace.com")).toThrow(/https/);
  });

  it("rejects empty input", () => {
    expect(() => parseEnvironmentUrl("   ")).toThrow(/Enter/);
  });
});
