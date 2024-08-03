// src/App.tsx
import React, { useState, useEffect } from "react";
import { auth, signInWithGoogle, signOutFromApp } from "./firebaseConfig";
import { onAuthStateChanged, User } from "firebase/auth";

const App: React.FC = () => {
  const [targetUrl, setTargetUrl] = useState("");
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUser(user);
      } else {
        setUser(null);
      }
    });

    return () => unsubscribe();
  }, []);

  return (
    <div className="h-screen bg-gray-100 p-4">
      <div className="w-full max-w-sm mx-auto">
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
          className={`w-full px-4 py-2 rounded-lg ${
            user ? "bg-green-500 text-white" : "bg-gray-400 text-gray-700"
          }`}
          disabled={!user}
        >
          Scrape
        </button>
      </div>
    </div>
  );
};

export default App;
