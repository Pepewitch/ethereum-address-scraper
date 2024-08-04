// src/App.tsx
import React, { useState, useEffect, useCallback } from "react";
import { auth, signInWithGoogle, signOutFromApp } from "./firebaseConfig";
import { onAuthStateChanged, User } from "firebase/auth";
import axios from "axios";
import { client } from "./queryClient";
import { useQuery } from "@tanstack/react-query";
import { Contract, JsonRpcProvider } from "ethers";
import ERC20Abi from "./ERC20.abi.json";
import { makeAutoObservable, runInAction } from "mobx";
import { observer } from "mobx-react-lite";
import asyncPool from "tiny-async-pool";

type ScrapeResponse = {
  message: string;
  results: {
    address: string;
    src: string;
    type: string;
    targets: string[];
  }[];
};

enum Chain {
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

// create axios instance
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
});

const blockscanBaseUrlMap = {
  [Chain.ETHEREUM]: "https://etherscan.io",
  [Chain.BSC]: "https://bscscan.com",
  [Chain.POLYGON]: "https://polygonscan.com",
  [Chain.ARBITRUM]: "https://arbiscan.io",
  [Chain.OPTIMISM]: "https://optimistic.etherscan.io",
  [Chain.BASE]: "https://basescan.org",
  [Chain.AVALANCHE]: "https://snowtrace.io",
  [Chain.FANTOM]: "https://ftmscan.com",
  [Chain.MANTLE]: "https://mantle.xyz",
  [Chain.ZKSYNC]: "https://zkscan.io",
  [Chain.LINEA]: "https://lineascan.build",
  [Chain.BLAST]: "https://blastscan.io",
};

const providerMap = {
  [Chain.ETHEREUM]: new JsonRpcProvider("https://eth.llamarpc.com"),
  [Chain.BSC]: new JsonRpcProvider("https://bsc-dataseed1.ninicoin.io"),
  [Chain.POLYGON]: new JsonRpcProvider("https://polygon.llamarpc.com"),
  [Chain.ARBITRUM]: new JsonRpcProvider("https://arbitrum.llamarpc.com"),
  [Chain.OPTIMISM]: new JsonRpcProvider("https://optimism-rpc.publicnode.com"),
  [Chain.BASE]: new JsonRpcProvider("https://base-rpc.publicnode.com"),
  [Chain.AVALANCHE]: new JsonRpcProvider(
    "https://api.avax.network/ext/bc/C/rpc"
  ),
  [Chain.FANTOM]: new JsonRpcProvider("https://rpc.ftm.tools"),
  [Chain.MANTLE]: new JsonRpcProvider("https://rpc.mantle.xyz"),
  [Chain.ZKSYNC]: new JsonRpcProvider("https://1rpc.io/zksync2-era"),
  [Chain.LINEA]: new JsonRpcProvider("https://rpc.linea.build"),
  [Chain.BLAST]: new JsonRpcProvider("https://rpc.blast.io"),
};

const maskAddress = (address: string) => {
  return address.slice(0, 6) + "..." + address.slice(-4);
};

enum AddressType {
  EOA = "EOA",
  TOKEN = "TOKEN",
  UNKNOWN_CONTRACT = "UNKNOWN CONTRACT",
  UNKNOWN = "UNKNOWN",
}
interface AddressInfo {
  type: AddressType;
  symbol?: string;
  error?: boolean;
}
const checkAddressTypesBatch = async (addresses: string[], chain: Chain) => {
  const provider = providerMap[chain];
  if (!provider) return;

  const poolSize = 20; // Adjust this value based on your needs

  const processAddress = async (address: string) => {
    try {
      console.log("fetching code", address);
      const code = await provider.getCode(address);

      if (code === "0x") {
        console.log("is eoa", address);
        runInAction(() => {
          addressStore.setAddressInfo(address, chain, {
            type: AddressType.EOA,
          });
        });
        return;
      }
      const contract = new Contract(address, ERC20Abi, provider);

      try {
        const symbol = await contract.symbol();
        runInAction(() => {
          addressStore.setAddressInfo(address, chain, {
            type: AddressType.TOKEN,
            symbol,
          });
        });
      } catch {
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

class AddressStore {
  addressInfo: Record<string, AddressInfo> = {};

  constructor() {
    makeAutoObservable(this);
  }

  setAddressInfo(address: string, chain: Chain, info: AddressInfo) {
    this.addressInfo[`${address}-${chain}`] = info;
  }

  getAddressInfo(address: string, chain: Chain): AddressInfo {
    return (
      this.addressInfo[`${address}-${chain}`] || { type: "" as AddressType }
    );
  }
}
const addressStore = new AddressStore();

const App: React.FC = observer(() => {
  const [targetUrl, setTargetUrl] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<ScrapeResponse>();
  const [isScraping, setIsScraping] = useState(false);
  const [selectedChain, setSelectedChain] = useState<Chain | "">("");
  const [showEOA, setShowEOA] = useState(false);
  const [showToken, setShowToken] = useState(true);
  const [showUnknownContract, setShowUnknownContract] = useState(true);

  const toggleFilter = (
    filter: "showEOA" | "showToken" | "showUnknownContract"
  ) => {
    switch (filter) {
      case "showEOA":
        setShowEOA((prev) => !prev);
        break;
      case "showToken":
        setShowToken((prev) => !prev);
        break;
      case "showUnknownContract":
        setShowUnknownContract((prev) => !prev);
        break;
    }
  };

  const shouldShowAddress = (type: AddressType): boolean => {
    switch (type) {
      case AddressType.EOA:
        return showEOA;
      case AddressType.TOKEN:
        return showToken;
      case AddressType.UNKNOWN_CONTRACT:
        return showUnknownContract;
      case AddressType.UNKNOWN:
      default:
        return type ? false : true; // Show by default if type is not recognized
    }
  };
  // For solving cold start issue
  useQuery({
    queryKey: ["ping"],
    queryFn: async () => {
      const response = await api.get<{ message: string }>("/ping");
      return response.data;
    },
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const idToken = await user.getIdToken();
        api.defaults.headers.common["Authorization"] = `Bearer ${idToken}`;
        setUser(user);
      } else {
        api.defaults.headers.common["Authorization"] = "";
        setUser(null);
      }
    });

    return () => unsubscribe();
  }, []);

  const downloadCSV = () => {
    if (!filteredData) return;

    const csvContent = [
      ["Address", "Address Type", "Symbol"],
      ...filteredData.map((result) => {
        const addressInfo = addressStore.getAddressInfo(
          result.address,
          selectedChain as Chain
        );
        return [
          result.address,
          addressInfo.type,
          addressInfo.type === AddressType.TOKEN ? addressInfo.symbol : "-",
        ];
      }),
    ]
      .map((row) => row.join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "scraped_addresses.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleScrape = useCallback(async () => {
    setSelectedChain("");
    if (!user || !targetUrl) return;
    try {
      setIsScraping(true);
      const data = await client.fetchQuery({
        queryKey: ["scrape", targetUrl],
        queryFn: async () => {
          const response = await api.post<ScrapeResponse>("/scrape", {
            targets: [targetUrl],
          });
          return response.data;
        },
      });
      setData(data);
    } catch (error) {
      alert("Failed to scrape URL");
      setData(undefined);
    } finally {
      setIsScraping(false);
    }
  }, [user, targetUrl]);

  const handleSelectChain = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const chain = e.target.value as Chain;
    setSelectedChain(chain);

    if (data?.results && chain) {
      const addresses = data.results.map((result) => result.address);
      checkAddressTypesBatch(addresses, chain);
    }
  };

  const filteredData = data?.results.filter((result) => {
    const addressInfo = addressStore.getAddressInfo(
      result.address,
      selectedChain as Chain
    );
    return shouldShowAddress(addressInfo.type);
  });
  return (
    <div className="h-full min-h-screen bg-gray-100 p-4">
      <div className="w-full max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Ethereum Address Scraper</h1>
        <p className="my-2 font-bold">
          1. Login to use the app {user ? "✅" : ""}
        </p>
        {user ? (
          <>
            <p className="mb-2 text-gray-700 font-bold">
              Logged in as: {user.email}
            </p>
            <button
              className="mb-4 text-red-500 border-red-500 hover:bg-red-500 hover:text-white px-4 py-2 rounded-lg w-full"
              onClick={signOutFromApp}
            >
              Logout
            </button>
          </>
        ) : (
          <button
            className="mb-4 bg-blue-500 text-white px-4 py-2 rounded-lg w-full"
            onClick={signInWithGoogle}
          >
            Login with Google
          </button>
        )}

        <p className="font-bold my-2">2. Enter the URL to scrape</p>
        <p className="text-gray-700 text-sm mb-4">
          Note: This will scrape Ethereum address from HTML and the scrips
          inside the HTML. It will not scrape everything on the network.
        </p>
        <label
          htmlFor="target-url"
          className="block text-gray-700 font-bold mb-2"
        >
          Target URL
        </label>
        <input
          id="target-url"
          type="text"
          className="w-full px-3 py-2 mb-4 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          disabled={!user}
        />

        <button
          className={`w-full px-4 py-2 rounded-lg mb-6 ${
            user ? "bg-green-500 text-white" : "bg-gray-400 text-gray-700"
          }`}
          disabled={!user}
          onClick={handleScrape}
        >
          Scrape
        </button>
        {isScraping && <p className="text-gray-700">Scraping...</p>}
        {data && (
          <div className="bg-white p-4 rounded-lg shadow-md">
            <p className="text-gray-700 font-bold mb-2">Select Chain</p>
            <div className="flex space-x-4 mb-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={showEOA}
                  onChange={() => toggleFilter("showEOA")}
                  className="mr-2"
                />
                Show EOA
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={showToken}
                  onChange={() => toggleFilter("showToken")}
                  className="mr-2"
                />
                Show Token
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={showUnknownContract}
                  onChange={() => toggleFilter("showUnknownContract")}
                  className="mr-2"
                />
                Show Unknown Contract
              </label>
            </div>
            <select
              className="w-full px-3 py-2 mb-4 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedChain}
              onChange={handleSelectChain}
              disabled={!user}
            >
              {Object.values(Chain).map((chain) => (
                <option key={chain} value={chain}>
                  {chain.charAt(0).toUpperCase() + chain.slice(1)}
                </option>
              ))}
              <option value={""}>Please select chain</option>
            </select>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">Results</h2>
              <button
                className="bg-blue-500 text-white px-4 py-2 rounded-lg"
                onClick={downloadCSV}
                disabled={!filteredData || filteredData.length === 0}
              >
                Download CSV
              </button>
            </div>
            <div className="w-full overflow-auto">
              <table className="w-full border-gray-300 border-solid border">
                <thead>
                  <tr>
                    <th className="text-left p-2">Address</th>
                    <th className="text-left p-2">Address Type</th>
                    <th className="text-left p-2">Symbol</th>
                    <th className="text-right p-2">Blockscan</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData?.map((result, index) => {
                    const addressInfo = addressStore.getAddressInfo(
                      result.address,
                      selectedChain as Chain
                    );
                    return (
                      <tr key={`${index}-${result.address}-${selectedChain}`}>
                        <td className="px-2">{maskAddress(result.address)}</td>
                        <td className="px-2">{addressInfo.type}</td>
                        <td className="px-2">
                          {addressInfo.type === AddressType.TOKEN
                            ? addressInfo.symbol
                            : "-"}
                        </td>
                        <td className="text-right px-2">
                          <a
                            href={`${
                              blockscanBaseUrlMap[
                                selectedChain || Chain.ETHEREUM
                              ]
                            }/address/${result.address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default App;
