import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { fetchSpendableBalance, useBalance } from "../../hooks/useBalance";
import { useWalletStore } from "../../store/wallet";
import { USDC_ISSUER } from "@meridian/shared";

const KEY = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC_ISSUER_TESTNET = USDC_ISSUER.testnet;

function mockHorizonAccountResponse(balances: Array<Record<string, unknown>>) {
  return new Response(JSON.stringify({ balances }), { status: 200 });
}

function setup(publicKey: string | null = KEY, network: string = "testnet") {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);

  const utils = renderHook(
    ({ pk, net }: { pk: string | null; net: string }) => useBalance(pk, net),
    {
      wrapper,
      initialProps: { pk: publicKey, net: network },
    }
  );
  return { client, ...utils };
}

describe("fetchSpendableBalance", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the spendable USDC balance for the matching issuer", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockHorizonAccountResponse([
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: USDC_ISSUER_TESTNET,
          balance: "123.4500000",
        },
      ])
    );

    const balance = await fetchSpendableBalance(KEY, "testnet");
    expect(balance).toBe(123.45);
  });

  it("deducts selling liabilities from the raw balance", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockHorizonAccountResponse([
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: USDC_ISSUER_TESTNET,
          balance: "100.0000000",
          selling_liabilities: "25.0000000",
        },
      ])
    );

    const balance = await fetchSpendableBalance(KEY, "testnet");
    expect(balance).toBe(75);
  });

  it("clamps to 0 when liabilities exceed balance", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockHorizonAccountResponse([
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: USDC_ISSUER_TESTNET,
          balance: "10.0000000",
          selling_liabilities: "20.0000000",
        },
      ])
    );

    const balance = await fetchSpendableBalance(KEY, "testnet");
    expect(balance).toBe(0);
  });

  it("returns 0 when the account does not hold USDC", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockHorizonAccountResponse([
        {
          asset_type: "native",
          balance: "100.0000000",
        },
      ])
    );

    const balance = await fetchSpendableBalance(KEY, "testnet");
    expect(balance).toBe(0);
  });

  it("throws when the Horizon read fails (non-ok response)", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "not found" }), { status: 404 })
    );

    await expect(fetchSpendableBalance(KEY, "testnet")).rejects.toThrow(
      /Failed to fetch balance from Horizon/
    );
  });
});

describe("useBalance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWalletStore.setState({
      publicKey: KEY,
      connected: true,
      network: "testnet",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockHorizonAccountResponse([
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: USDC_ISSUER_TESTNET,
            balance: "50.0000000",
          },
        ])
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and returns the wallet spendable balance", async () => {
    const { result } = setup();

    await waitFor(() => {
      expect(result.current.data).toBe(50);
    });

    expect(result.current.balance).toBe(50);
    expect(result.current.spendableBalance).toBe(50);
    expect(result.current.isError).toBe(false);
  });

  it("does not fetch when publicKey is null", () => {
    const { result } = setup(null);

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("enters error state when Horizon read fails", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "server error" }), { status: 500 })
    );

    const { result } = setup();

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.balance).toBeUndefined();
  });
});
