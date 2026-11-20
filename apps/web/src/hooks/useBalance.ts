import { useQuery } from "@tanstack/react-query";
import { USDC_ISSUER } from "@meridian/shared";
import { fetchBalances } from "../lib/horizonAccount";
import { useWalletStore } from "../store/wallet";

/**
 * Reads the spendable USDC balance for the given account from Horizon.
 * Deducts selling liabilities if present.
 * Throws when Horizon returns non-ok or the account cannot be read.
 */
export async function fetchSpendableBalance(
  publicKey: string,
  network: string
): Promise<number> {
  const account = await fetchBalances(publicKey, network);
  if (!account) {
    throw new Error(`Failed to fetch balance from Horizon for ${publicKey}`);
  }

  const issuer = USDC_ISSUER[network];
  const usdc = account.balances.find(
    (b) => b.asset_code === "USDC" && (!issuer || b.asset_issuer === issuer)
  );

  if (!usdc) return 0;

  const rawBalance = parseFloat(usdc.balance);
  if (Number.isNaN(rawBalance)) return 0;

  const liabilities = parseFloat(
    (usdc as { selling_liabilities?: string }).selling_liabilities ?? "0"
  );
  const sellingLiabilities = Number.isNaN(liabilities) ? 0 : liabilities;

  return Math.max(0, rawBalance - sellingLiabilities);
}

export function useBalance(
  publicKeyOverride?: string | null,
  networkOverride?: string
) {
  const { publicKey: storeKey, network: storeNetwork } = useWalletStore();
  const publicKey =
    publicKeyOverride !== undefined ? publicKeyOverride : storeKey;
  const network =
    networkOverride !== undefined ? networkOverride : storeNetwork;

  const query = useQuery<number, Error>({
    queryKey: ["balance", publicKey, network],
    queryFn: async () => {
      if (!publicKey) throw new Error("No public key");
      return fetchSpendableBalance(publicKey, network);
    },
    enabled: Boolean(publicKey),
    staleTime: 15_000,
    retry: 1,
  });

  return {
    ...query,
    balance: query.data,
    spendableBalance: query.data,
  };
}

export const useWalletBalance = useBalance;
