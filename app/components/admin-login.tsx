"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Brand } from "./brand";
import { ArrowUpRight, CheckIcon } from "./icons";
import styles from "./admin-login.module.css";

export function AdminLogin() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Accesso non riuscito.");
      }
      router.replace("/admin");
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Accesso non riuscito."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.shell}>
      <section className={styles.card}>
        <Brand />
        <div className={styles.heading}>
          <span>Area riservata</span>
          <h1>Agenda del barbiere</h1>
          <p>
            Inserisci la password operativa per leggere e modificare l’agenda
            centrale.
          </p>
        </div>
        <form onSubmit={submit}>
          <label>
            <span>Password</span>
            <input
              autoComplete="current-password"
              autoFocus
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button
            className="admin-primary"
            disabled={!password || loading}
            type="submit"
          >
            {loading ? <CheckIcon /> : <ArrowUpRight />}
            {loading ? "Accesso in corso…" : "Apri agenda"}
          </button>
        </form>
      </section>
    </main>
  );
}
