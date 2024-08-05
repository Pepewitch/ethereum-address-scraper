// src/App.tsx
import React, { useState, useEffect, useCallback } from "react";
import { auth, signInWithGoogle, signOutFromApp } from "./firebaseConfig";
import { onAuthStateChanged, User } from "firebase/auth";
import axios from "axios";
import { client } from "./queryClient";
import { useQuery } from "@tanstack/react-query";
import { observer } from "mobx-react-lite";
import { addressStore, AddressType } from "./AddressStore";
import { checkAddressTypesBatch } from "./ChainUtils";

type ScrapeResponse = {
  message: string;
  results:
    | {
        address: string;
        src: string;
        type: string;
        targets: string[];
      }[]
    | null;
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

const maskAddress = (address: string) => {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

const App: React.FC = observer(() => {
  const [targetUrl, setTargetUrl] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<ScrapeResponse>();
  const [isScraping, setIsScraping] = useState(false);
  const [selectedChain, setSelectedChain] = useState<Chain | "">("");
  const [showEOA, setShowEOA] = useState(false);
  const [showToken, setShowToken] = useState(true);
  const [showUnknownContract, setShowUnknownContract] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;

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
      checkAddressTypesBatch(addresses, chain, addressStore);
    }
  };

  const filteredData = data?.results?.filter((result) => {
    const addressInfo = addressStore.getAddressInfo(
      result.address,
      selectedChain as Chain
    );
    return shouldShowAddress(addressInfo.type);
  });

  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredData?.slice(indexOfFirstItem, indexOfLastItem);

  const totalPages = Math.ceil((filteredData?.length || 0) / itemsPerPage);

  const handlePageChange = (pageNumber: number) => {
    setCurrentPage(pageNumber);
  };

  const renderPageNumbers = () => {
    const pageNumbers = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) {
        pageNumbers.push(
          <button
            key={i}
            onClick={() => handlePageChange(i)}
            className={`mx-1 px-3 py-1 rounded ${
              currentPage === i
                ? "bg-blue-500 text-white"
                : "bg-gray-200 text-gray-700"
            }`}
          >
            {i}
          </button>
        );
      }
    } else {
      // Always show first two pages
      for (let i = 1; i <= 2; i++) {
        pageNumbers.push(
          <button
            key={i}
            onClick={() => handlePageChange(i)}
            className={`mx-1 px-3 py-1 rounded ${
              currentPage === i
                ? "bg-blue-500 text-white"
                : "bg-gray-200 text-gray-700"
            }`}
          >
            {i}
          </button>
        );
      }

      // Add ellipsis if current page is more than 3
      if (currentPage > 3) {
        pageNumbers.push(<span key="ellipsis1">...</span>);
      }

      // Show current page and surrounding pages
      const startPage = Math.max(3, currentPage - 1);
      const endPage = Math.min(totalPages - 2, currentPage + 1);
      for (let i = startPage; i <= endPage; i++) {
        pageNumbers.push(
          <button
            key={i}
            onClick={() => handlePageChange(i)}
            className={`mx-1 px-3 py-1 rounded ${
              currentPage === i
                ? "bg-blue-500 text-white"
                : "bg-gray-200 text-gray-700"
            }`}
          >
            {i}
          </button>
        );
      }

      // Add ellipsis if current page is less than total pages - 2
      if (currentPage < totalPages - 2) {
        pageNumbers.push(<span key="ellipsis2">...</span>);
      }

      // Always show last two pages
      for (let i = totalPages - 1; i <= totalPages; i++) {
        pageNumbers.push(
          <button
            key={i}
            onClick={() => handlePageChange(i)}
            className={`mx-1 px-3 py-1 rounded ${
              currentPage === i
                ? "bg-blue-500 text-white"
                : "bg-gray-200 text-gray-700"
            }`}
          >
            {i}
          </button>
        );
      }
    }
    return pageNumbers;
  };
  return (
    <div className="h-full min-h-screen bg-gray-100 p-4">
      <div className="w-full max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-6 text-black">
          Ethereum Address Scraper
        </h1>
        <p className="my-2 font-bold text-black">
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

        <p className="font-bold my-2 text-black">2. Enter the URL to scrape</p>
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
            {data.results === null ? (
              <p className="text-red-500 font-bold mb-4">
                Error: We couldn't find any Ethereum addresses. This might be
                due to Cloudflare protection or other anti-scraping measures on
                the website.
              </p>
            ) : (
              <>
                <div className="flex space-x-4 mb-4">
                  <label className="flex items-center text-black">
                    <input
                      type="checkbox"
                      checked={showEOA}
                      onChange={() => toggleFilter("showEOA")}
                      className="mr-2"
                    />
                    Show EOA
                  </label>
                  <label className="flex items-center text-black">
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
                <p className="text-gray-700 font-bold mb-2">Select Chain</p>
                <p className="text-gray-700 text-sm mb-2">
                  Note: Selecting the chain will fetch the Address Type and
                  Symbol for the results.
                </p>
                <select
                  className="w-full px-3 py-2 mb-4 border bg-transparent border-gray-300 text-black rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={selectedChain}
                  onChange={handleSelectChain}
                  disabled={!user}
                >
                  {Object.values(Chain).map((chain) => (
                    <option key={chain} value={chain} className="text-black">
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
                        <th className="text-left p-2 text-black">Address</th>
                        <th className="text-left p-2 text-black">Address Type</th>
                        <th className="text-left p-2 text-black">Symbol</th>
                        <th className="text-right p-2 text-black">Blockscan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentItems?.map((result, index) => {
                        const addressInfo = addressStore.getAddressInfo(
                          result.address,
                          selectedChain as Chain
                        );
                        return (
                          <tr
                            key={`${index}-${result.address}-${selectedChain}`}
                          >
                            <td className="px-2 text-black">
                              {maskAddress(result.address)}
                            </td>
                            <td className="px-2 text-black">
                              {addressInfo.type}
                            </td>
                            <td className="px-2 text-black">
                              {addressInfo.type === AddressType.TOKEN
                                ? addressInfo.symbol
                                : "-"}
                            </td>
                            <td className="text-right px-2 text-black">
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
                <div className="mt-4 flex justify-center items-center">
                  <button
                    onClick={() =>
                      handlePageChange(Math.max(1, currentPage - 1))
                    }
                    disabled={currentPage === 1}
                    className="mx-1 px-3 py-1 rounded bg-gray-200 text-gray-700 disabled:opacity-50"
                  >
                    &lt;
                  </button>
                  {renderPageNumbers()}
                  <button
                    onClick={() =>
                      handlePageChange(Math.min(totalPages, currentPage + 1))
                    }
                    disabled={currentPage === totalPages}
                    className="mx-1 px-3 py-1 rounded bg-gray-200 text-gray-700 disabled:opacity-50"
                  >
                    &gt;
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export default App;
