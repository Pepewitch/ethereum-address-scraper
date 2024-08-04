import { JsonRpcProvider, Contract } from "ethers";
import ERC20Abi from "./ERC20.abi.json";
import asyncPool from "tiny-async-pool";
import { runInAction } from "mobx";
import { AddressStore, AddressType } from "./AddressStore";
import {
  arbitrumRpcUrls,
  avaxRpcUrls,
  baseRpcUrls,
  blastRpcUrls,
  bscRpcUrls,
  ethRpcUrls,
  fantomRpcUrls,
  lineaRpcUrls,
  mantleRpcUrls,
  opRpcUrls,
  polygonRpcUrls,
  zkSyncRpcUrls,
} from "./rpc";

export enum Chain {
  ETHEREUM = "ethereum",
  BSC = "bsc",
  POLYGON = "polygon",
  ARBITRUM = "arbitrum",
  OPTIMISM = "optimism",
  BASE = "base",
  AVALANCHE = "avalanche",
  FANTOM = "fantom",
  MANTLE = "mantle",
  ZKSYNC = "zksync",
  LINEA = "linea",
  BLAST = "blast",
}

export const providerUrlsMap: Record<Chain, string[]> = {
  [Chain.ETHEREUM]: ethRpcUrls,
  [Chain.BSC]: bscRpcUrls,
  [Chain.POLYGON]: polygonRpcUrls,
  [Chain.ARBITRUM]: arbitrumRpcUrls,
  [Chain.OPTIMISM]: opRpcUrls,
  [Chain.BASE]: baseRpcUrls,
  [Chain.AVALANCHE]: avaxRpcUrls,
  [Chain.FANTOM]: fantomRpcUrls,
  [Chain.MANTLE]: mantleRpcUrls,
  [Chain.ZKSYNC]: zkSyncRpcUrls,
  [Chain.LINEA]: lineaRpcUrls,
  [Chain.BLAST]: blastRpcUrls,
};

export class ChainUtils {
  private static providerCache: Record<string, JsonRpcProvider> = {};

  private static unusableUrls: Set<string> = new Set();

  static async getProvider(chain: Chain): Promise<JsonRpcProvider | null> {
    const urls = providerUrlsMap[chain].filter(
      (url) => !this.unusableUrls.has(url)
    );
    if (urls.length === 0) return null;

    while (urls.length > 0) {
      const randomIndex = Math.floor(Math.random() * urls.length);
      const selectedUrl = urls[randomIndex];

      if (this.providerCache[selectedUrl]) {
        return this.providerCache[selectedUrl];
      }

      const provider = new JsonRpcProvider(selectedUrl);
      try {
        const blockNumberPromise = provider.getBlockNumber();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), 1000)
        );

        await Promise.race([blockNumberPromise, timeoutPromise]);

        this.providerCache[selectedUrl] = provider;
        return provider;
      } catch (error) {
        console.warn(
          `Provider ${selectedUrl} is unresponsive. Trying another...`
        );
        this.unusableUrls.add(selectedUrl);
        urls.splice(randomIndex, 1);
      }
    }

    return null;
  }

  static async isContract(address: string, chain: Chain) {
    const provider = await this.getProvider(chain);
    if (!provider) return;
    const code = await provider.getCode(address);
    return code !== "0x";
  }

  static async getTokenSymbol(address: string, chain: Chain) {
    const provider = await this.getProvider(chain);
    if (!provider) return null;
    const contract = new Contract(address, ERC20Abi, provider);
    try {
      const symbol = await contract.symbol();
      return symbol;
    } catch (error) {
      return null;
    }
  }
}

const retry = async <T>(fn: () => Promise<T>, maxRetry = 3) => {
  let retryCount = 0;
  while (retryCount < maxRetry) {
    try {
      return await fn();
    } catch {
      retryCount++;
    }
  }
  throw new Error("Max retry reached");
};

export const checkAddressTypesBatch = async (
  addresses: string[],
  chain: Chain,
  addressStore: AddressStore
) => {
  const poolSize = 100;

  const processAddress = async (address: string) => {
    try {
      const isContract = await retry(() =>
        ChainUtils.isContract(address, chain)
      );

      if (!isContract) {
        console.log("is eoa", address);
        runInAction(() => {
          addressStore.setAddressInfo(address, chain, {
            type: AddressType.EOA,
          });
        });
        return;
      }
      const symbol = await retry(() =>
        ChainUtils.getTokenSymbol(address, chain)
      );
      if (symbol) {
        runInAction(() => {
          addressStore.setAddressInfo(address, chain, {
            type: AddressType.TOKEN,
            symbol,
          });
        });
      } else {
        runInAction(() => {
          addressStore.setAddressInfo(address, chain, {
            type: AddressType.UNKNOWN_CONTRACT,
          });
        });
      }
    } catch (error) {
      console.error(`Error processing address ${address}:`, error);
      runInAction(() => {
        addressStore.setAddressInfo(address, chain, {
          type: AddressType.UNKNOWN,
          error: true,
        });
      });
    }
    return address;
  };

  for await (const address of asyncPool(poolSize, addresses, processAddress)) {
    console.log("Done", address);
  }
};
