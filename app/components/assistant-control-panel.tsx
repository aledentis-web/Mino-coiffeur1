"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./assistant-control-panel.module.css";

type AssistantControl = {
  businessId: string;
  businessActive: boolean;
  agentEnabled: boolean;
  whatsappEnabled: boolean;
  voiceEnabled: boolean;
  activatedAt: string | null;
  pausedAt: string | null;
  updatedAt: string | null;
  source: "database" | "legacy";
};

type AssistantConfiguration = {
  bookingEngine: boolean;
  languageAgent: boolean;
  whatsapp: boolean;
  browserVoice: boolean;
  phoneVoice: boolean;
  automations: boolean;
};

type AssistantMetrics = {
  periodStart: string;
  inboundMessages: number;
  processedMessages: number;
  repliesSent: number;
  failures: number;
  agentAppointments: number;
  whatsappAppointments: number;
  voiceAppointments: number;
  openAiCalls: number;
  inputTokens: number;
  outputTokens: number;
  openAiCostMicrousd: number;
  metaMessages: number;
  metaCostMicroeur: number;
};

type UsageEvent = {
  provider: string;
  event_type: string;
  model: string | null;
  input_units: number | string;
  output_units: number | string;
  cost_microunits: number | string;
  currency: string;
  occurred_at: string;
};

type ControlPayload = {
  control: AssistantControl;
  configuration: AssistantConfiguration;
  metrics: AssistantMetrics;
  recentUsage: UsageEvent[];
  error?: string;
};

const integerFormat = new Intl.NumberFormat("it-IT");

function formatMoney(microunits: number, currency: "USD" | "EUR") {
  const amount = microunits / 1_000_000;
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency,
    minimumFractionDigits: amount > 0 && amount < 0.01 ? 4 : 2,
    maximumFractionDigits: 6
  }).format(amount);
}

function formatDate(value: string | null) {
  if (!value) return "Mai";
  return new Intl.DateTimeFormat("it-IT", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Rome"
  }).format(new Date(value));
}

function usageLabel(eventType: string) {
  if (eventType === "language_turn") return "Turno AI";
  if (eventType === "inbound_message") return "Messaggio ricevuto";
  if (eventType === "service_reply") return "Risposta WhatsApp";
  if (eventType === "ignored_while_paused") return "Ignorato in pausa";
  return eventType.replaceAll("_", " ");
}

export function AssistantControlPanel() {
  const [payload, setPayload] = useState<ControlPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/admin/assistant/control", {
        cache: "no-store"
      });
      const next = (await response.json()) as ControlPayload;
      if (response.status === 401) {
        window.location.assign("/admin/login");
        return;
      }
      if (!response.ok) {
        throw new Error(next.error ?? "Pannello agente non disponibile.");
      }
      setPayload(next);
      setError("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Pannello agente non disponibile."
      );
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function updateControl(patch: Record<string, boolean>) {
    setUpdating(true);
    setError("");
    try {
      const response = await fetch("/api/admin/assistant/control", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      const result = (await response.json()) as {
        control?: AssistantControl;
        configuration?: AssistantConfiguration;
        error?: string;
      };
      if (response.status === 401) {
        window.location.assign("/admin/login");
        return;
      }
      if (!response.ok || !result.control) {
        throw new Error(result.error ?? "Modifica non riuscita.");
      }
      setPayload((current) =>
        current
          ? {
              ...current,
              control: result.control!,
              configuration: result.configuration ?? current.configuration
            }
          : current
      );
      await load(true);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Modifica non riuscita."
      );
    } finally {
      setUpdating(false);
    }
  }

  const operational = useMemo(() => {
    if (!payload?.control.agentEnabled) return false;
    return Boolean(
      (payload.control.whatsappEnabled && payload.configuration.whatsapp) ||
        (payload.control.voiceEnabled && payload.configuration.phoneVoice)
    );
  }, [payload]);

  if (loading && !payload) {
    return (
      <main className={styles.shell}>
        <div className={styles.loadingCard}>
          <span className={styles.spinner} />
          <strong>Controllo del segretario digitale</strong>
          <p>Sto leggendo canali, consumi e stato operativo.</p>
        </div>
      </main>
    );
  }

  const control = payload?.control;
  const configuration = payload?.configuration;
  const metrics = payload?.metrics;

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/admin">
          <span>SB8</span>
          <div>
            <strong>Studio Barber 8</strong>
            <small>Cabina di regia</small>
          </div>
        </Link>
        <nav>
          <Link href="/admin">Agenda</Link>
          <Link href="/admin/voice">Test voce</Link>
          <Link href="/">Sito clienti</Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Segretario digitale</p>
          <h1>Un tasto. Il negozio risponde da solo.</h1>
          <p className={styles.heroCopy}>
            Quando è attivo, l’agente gestisce i canali collegati e ogni
            prenotazione compare nella stessa agenda. Quando è in pausa, il
            webhook non risponde automaticamente.
          </p>
        </div>

        <article
          className={`${styles.masterCard} ${operational ? styles.live : styles.paused}`}
        >
          <div className={styles.masterStatus}>
            <span className={styles.statusDot} />
            <div>
              <small>Stato operativo</small>
              <strong>{operational ? "Agente attivo" : "Agente in pausa"}</strong>
            </div>
          </div>
          <button
            aria-pressed={control?.agentEnabled ?? false}
            className={styles.masterButton}
            disabled={updating || !control}
            onClick={() =>
              void updateControl({ agentEnabled: !control?.agentEnabled })
            }
            type="button"
          >
            <span>{control?.agentEnabled ? "Metti in pausa" : "Attiva agente"}</span>
            <i aria-hidden="true" />
          </button>
          <p>
            Ultima modifica: <strong>{formatDate(control?.updatedAt ?? null)}</strong>
          </p>
        </article>
      </section>

      {error ? (
        <div className={styles.errorBox} role="alert">
          <strong>Serve attenzione</strong>
          <span>{error}</span>
        </div>
      ) : null}

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p>Canali</p>
            <h2>Dove lavora l’agente</h2>
          </div>
          <span>Interruttori salvati sul database</span>
        </div>

        <div className={styles.channelGrid}>
          <article className={styles.channelCard}>
            <div className={styles.channelTitle}>
              <span className={styles.channelIcon}>WA</span>
              <div>
                <strong>WhatsApp</strong>
                <small>
                  {configuration?.whatsapp
                    ? "Meta Cloud API collegata"
                    : "Configurazione Meta incompleta"}
                </small>
              </div>
            </div>
            <button
              aria-label="Attiva o disattiva il canale WhatsApp"
              aria-pressed={control?.whatsappEnabled ?? false}
              className={`${styles.switch} ${
                control?.whatsappEnabled ? styles.switchOn : ""
              }`}
              disabled={updating || !configuration?.whatsapp}
              onClick={() =>
                void updateControl({
                  whatsappEnabled: !control?.whatsappEnabled
                })
              }
              type="button"
            >
              <i />
            </button>
            <div className={styles.channelFacts}>
              <span>
                <b>{integerFormat.format(metrics?.inboundMessages ?? 0)}</b>
                messaggi ricevuti
              </span>
              <span>
                <b>{integerFormat.format(metrics?.whatsappAppointments ?? 0)}</b>
                appuntamenti creati
              </span>
            </div>
          </article>

          <article className={styles.channelCard}>
            <div className={styles.channelTitle}>
              <span className={styles.channelIcon}>TEL</span>
              <div>
                <strong>Telefonate</strong>
                <small>
                  {configuration?.phoneVoice
                    ? "Numero SIP collegato"
                    : "Numero SIP ancora da collegare"}
                </small>
              </div>
            </div>
            <button
              aria-label="Attiva o disattiva il canale telefonico"
              aria-pressed={control?.voiceEnabled ?? false}
              className={`${styles.switch} ${
                control?.voiceEnabled ? styles.switchOn : ""
              }`}
              disabled={updating || !configuration?.phoneVoice}
              onClick={() =>
                void updateControl({ voiceEnabled: !control?.voiceEnabled })
              }
              type="button"
            >
              <i />
            </button>
            <div className={styles.channelFacts}>
              <span>
                <b>{integerFormat.format(metrics?.voiceAppointments ?? 0)}</b>
                appuntamenti vocali
              </span>
              <span>
                <b>{configuration?.browserVoice ? "Pronto" : "No"}</b>
                laboratorio voce
              </span>
            </div>
          </article>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p>Questo mese</p>
            <h2>Consumi e risultati</h2>
          </div>
          <span>Dati reali registrati per Studio Barber 8</span>
        </div>

        <div className={styles.metricGrid}>
          <article>
            <span>Appuntamenti dell’agente</span>
            <strong>{integerFormat.format(metrics?.agentAppointments ?? 0)}</strong>
            <small>WhatsApp + telefono</small>
          </article>
          <article>
            <span>Risposte consegnate</span>
            <strong>{integerFormat.format(metrics?.repliesSent ?? 0)}</strong>
            <small>su {integerFormat.format(metrics?.inboundMessages ?? 0)} messaggi</small>
          </article>
          <article>
            <span>Chiamate al modello</span>
            <strong>{integerFormat.format(metrics?.openAiCalls ?? 0)}</strong>
            <small>{integerFormat.format((metrics?.inputTokens ?? 0) + (metrics?.outputTokens ?? 0))} token</small>
          </article>
          <article>
            <span>Costo OpenAI stimato</span>
            <strong>{formatMoney(metrics?.openAiCostMicrousd ?? 0, "USD")}</strong>
            <small>calcolato dai token registrati</small>
          </article>
          <article>
            <span>Costo messaggi Meta</span>
            <strong>{formatMoney(metrics?.metaCostMicroeur ?? 0, "EUR")}</strong>
            <small>{integerFormat.format(metrics?.metaMessages ?? 0)} eventi tracciati</small>
          </article>
          <article className={metrics?.failures ? styles.warningMetric : ""}>
            <span>Errori operativi</span>
            <strong>{integerFormat.format(metrics?.failures ?? 0)}</strong>
            <small>{metrics?.failures ? "da verificare" : "nessun errore registrato"}</small>
          </article>
        </div>
      </section>

      <section className={styles.bottomGrid}>
        <article className={styles.readinessCard}>
          <div className={styles.sectionHeading}>
            <div>
              <p>Prontezza</p>
              <h2>Checklist installazione</h2>
            </div>
          </div>
          <ul>
            <li data-ready={configuration?.bookingEngine}>
              <i />
              <div><strong>Agenda e database</strong><span>Fonte unica degli appuntamenti</span></div>
            </li>
            <li data-ready={configuration?.languageAgent}>
              <i />
              <div><strong>Motore conversazionale</strong><span>OpenAI configurata lato server</span></div>
            </li>
            <li data-ready={configuration?.whatsapp}>
              <i />
              <div><strong>WhatsApp Business</strong><span>Webhook e numero Meta</span></div>
            </li>
            <li data-ready={configuration?.phoneVoice}>
              <i />
              <div><strong>Numero telefonico</strong><span>Provider SIP e Realtime</span></div>
            </li>
          </ul>
        </article>

        <article className={styles.ledgerCard}>
          <div className={styles.sectionHeading}>
            <div>
              <p>Registro</p>
              <h2>Ultimi consumi</h2>
            </div>
          </div>
          {payload?.recentUsage.length ? (
            <div className={styles.ledgerList}>
              {payload.recentUsage.slice(0, 8).map((event, index) => {
                const cost = Number(event.cost_microunits ?? 0);
                return (
                  <div key={`${event.occurred_at}-${event.provider}-${index}`}>
                    <span className={styles.provider}>{event.provider}</span>
                    <div>
                      <strong>{usageLabel(event.event_type)}</strong>
                      <small>{formatDate(event.occurred_at)}{event.model ? ` · ${event.model}` : ""}</small>
                    </div>
                    <b>
                      {cost
                        ? formatMoney(
                            cost,
                            event.currency === "EUR" ? "EUR" : "USD"
                          )
                        : "—"}
                    </b>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={styles.emptyLedger}>
              <strong>Nessun consumo ancora registrato</strong>
              <p>Il primo messaggio reale popolerà automaticamente questo registro.</p>
            </div>
          )}
        </article>
      </section>

      <footer className={styles.footer}>
        <p>
          Stato salvato per attività · aggiornamento automatico ogni 30 secondi
        </p>
        <div>
          <Link href="/admin">Apri agenda</Link>
          <Link href="/admin/voice">Prova l’agente</Link>
        </div>
      </footer>
    </main>
  );
}
