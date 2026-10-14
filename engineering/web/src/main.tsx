import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import type { Config } from "./types";
import { setLocalPreview } from "./api";
import App from "./App";
import SignIn from "./SignIn";
import "./style.css";

function Entry() {
  const [config, setConfig] = useState<Config>();
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let dispose = () => {};
    let cancelled = false;
    fetch("/engineering-api/config")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((c: Config) => {
        if (cancelled) return;
        setConfig(c);
        setLocalPreview(c.local_preview);
        if (c.local_preview) setSignedIn(true);
        else {
          initializeApp(c.firebase);
          dispose = onAuthStateChanged(getAuth(), (user) =>
            setSignedIn(!!user),
          );
        }
      })
      .catch(() =>
        setError("The engineering service is unavailable. Please retry."),
      );
    return () => {
      cancelled = true;
      dispose();
    };
  }, []);
  if (error)
    return (
      <main className="startup">
        <h1>Engineering console</h1>
        <p role="alert">{error}</p>
        <button onClick={() => location.reload()}>Retry</button>
      </main>
    );
  if (!config)
    return (
      <main className="startup" role="status">
        Opening engineering workspace…
      </main>
    );
  return signedIn ? (
    <App config={config} logout={() => signOut(getAuth())} />
  ) : (
    <SignIn />
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Entry />
  </StrictMode>,
);
