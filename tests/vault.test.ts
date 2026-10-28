import { describe, expect, it } from "vitest";
import { importFile, seal, unseal, type Environment } from "../src/store/vault";

const envs: Environment[] = [
  { id: "1", name: "Production", url: "abc12345", token: "dt0c01.SAMPLE.TOKEN" },
  { id: "2", name: "Staging", url: "https://dt.example.com/e/env01", token: "dt0c01.OTHER.TOKEN" },
];

describe("vault", () => {
  it("round-trips through AES-GCM", async () => {
    const sealed = await seal(envs, "correct horse", 1000);
    expect(JSON.stringify(sealed)).not.toContain("SAMPLE");
    await expect(unseal(sealed, "correct horse")).resolves.toEqual(envs);
  });

  it("rejects a wrong passphrase", async () => {
    const sealed = await seal(envs, "correct horse", 1000);
    await expect(unseal(sealed, "wrong horse!")).rejects.toThrow("Wrong passphrase.");
  });

  it("refuses short passphrases", async () => {
    await expect(seal(envs, "short")).rejects.toThrow(/at least 8/);
  });

  it("converts a DMM 1.x secrets.json once", async () => {
    const legacy = JSON.stringify({
      account_management: { account: "x", client_id: "y", secret: "z" },
      environments: [{ name: "Production", account: "abc12345", secret: "dt0c01.SAMPLE.TOKEN" }],
    });
    const [env] = await importFile(legacy);
    expect(env).toMatchObject({ name: "Production", url: "abc12345", token: "dt0c01.SAMPLE.TOKEN" });
  });

  it("opens an exported vault with its passphrase", async () => {
    const text = JSON.stringify(await seal(envs, "correct horse", 1000));
    const opened = await importFile(text, async () => "correct horse");
    expect(opened.map((e) => e.name)).toEqual(["Production", "Staging"]);
  });
});
