import { getAuth } from "firebase/auth";
import type { Snapshot } from "./types";

let local = false;
export function setLocalPreview(value: boolean) {
  local = value;
}
async function headers(): Promise<Record<string, string>> {
  if (local) return {};
  const user = getAuth().currentUser;
  if (!user) throw new Error("Sign in to continue.");
  return { Authorization: "Bearer " + (await user.getIdToken()) };
}

export async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/engineering-api/" + path, {
    headers: await headers(),
    signal,
    cache: "no-store",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || `The request failed (${response.status}).`);
  }
  return response.json();
}

export async function follow(
  signal: AbortSignal,
  update: (snapshot: Snapshot) => void,
) {
  const response = await fetch("/engineering-api/stream", {
    headers: await headers(),
    signal,
    cache: "no-store",
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "Live connection interrupted.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = event
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (data) update(JSON.parse(data.slice(6)));
      }
    }
  } finally {
    reader.releaseLock();
  }
}
