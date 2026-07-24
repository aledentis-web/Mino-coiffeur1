"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { syntheticCustomers } from "../lib/seed";
import { ArrowUpRight, HeadsetIcon, PhoneIcon } from "./icons";

type SpeechResultEvent = {
  results: ArrayLike<{
    0: { transcript: string };
    isFinal: boolean;
  }>;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult: ((event: SpeechResultEvent) => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

type ConversationMessage = {
  id: string;
  role: "customer" | "assistant";
  text: string;
};

export function VoiceLab() {
  const [customerId, setCustomerId] = useState(
    syntheticCustomers[0]?.id ?? ""
  );
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [listening, setListening] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      window.speechSynthesis?.cancel();
    };
  }, []);

  const customer =
    syntheticCustomers.find((item) => item.id === customerId) ??
    syntheticCustomers[0];

  function speak(text: string) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "it-IT";
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  }

  async function sendMessage(value: string) {
    const text = value.trim();
    if (!text || !customer || loading) return;

    const customerMessage: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "customer",
      text
    };
    setMessages((current) => [...current, customerMessage]);
    setDraft("");
    setFeedback("");
    setLoading(true);

    try {
      const response = await fetch("/api/admin/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: customer.phone,
          text,
          messageId: `voice:${crypto.randomUUID()}`
        })
      });
      const payload = (await response.json()) as {
        response?: string;
        error?: string;
      };

      if (response.status === 401) {
        window.location.assign("/admin/login");
        return;
      }
      if (!response.ok || !payload.response) {
        throw new Error(
          payload.error ?? "L’assistente non ha restituito una risposta."
        );
      }

      const assistantMessage: ConversationMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: payload.response
      };
      setMessages((current) => [...current, assistantMessage]);
      speak(payload.response);
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "L’assistente vocale non è disponibile."
      );
    } finally {
      setLoading(false);
    }
  }

  function startListening() {
    setFeedback("");
    const SpeechRecognition =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setFeedback(
        "Il riconoscimento vocale non è disponibile in questo browser. Usa Chrome oppure scrivi il messaggio."
      );
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "it-IT";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .filter((result) => result.isFinal)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (transcript) void sendMessage(transcript);
    };
    recognition.onerror = (event) => {
      setFeedback(
        event.error === "not-allowed"
          ? "Permesso microfono negato. Abilitalo nelle impostazioni del browser."
          : "Non sono riuscito a capire l’audio. Riprova."
      );
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
  }

  function changeCustomer(nextCustomerId: string) {
    window.speechSynthesis?.cancel();
    recognitionRef.current?.stop();
    setCustomerId(nextCustomerId);
    setMessages([]);
    setDraft("");
    setFeedback("");
  }

  return (
    <main className="voice-lab-shell">
      <header className="voice-lab-header">
        <div>
          <span>Studio Barber 8 · Ingresso 03</span>
          <h1>Laboratorio vocale</h1>
          <p>
            Parla dal browser: trascrizione, assistente e agenda usano lo
            stesso backend di WhatsApp.
          </p>
        </div>
        <div>
          <Link href="/admin">Torna all’agenda</Link>
          <Link className="quiet-button" href="/lab">
            Test 100 clienti
            <ArrowUpRight />
          </Link>
        </div>
      </header>

      <section className="voice-lab-grid">
        <aside className="voice-control-panel">
          <div className="voice-status">
            <span><HeadsetIcon /></span>
            <div>
              <small>Assistente backend</small>
              <strong>Collegato all’agenda</strong>
            </div>
          </div>

          <label>
            <span>Cliente simulato</span>
            <select
              value={customerId}
              onChange={(event) => changeCustomer(event.target.value)}
            >
              {syntheticCustomers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.phone}
                </option>
              ))}
            </select>
          </label>

          <button
            aria-pressed={listening}
            className={`voice-microphone ${listening ? "listening" : ""}`}
            disabled={loading}
            onClick={listening ? stopListening : startListening}
            type="button"
          >
            <span><PhoneIcon /></span>
            <strong>{listening ? "Sto ascoltando…" : "Parla con l’assistente"}</strong>
            <small>
              {listening
                ? "Premi per interrompere"
                : "Il browser chiederà il permesso per il microfono"}
            </small>
          </button>

          <div className="voice-security-note">
            <strong>Test protetto</strong>
            <p>
              L’endpoint è accessibile solo dalla sessione amministratore.
              Nessuna credenziale Twilio viene inviata al browser.
            </p>
          </div>
        </aside>

        <section className="voice-conversation">
          <div className="voice-conversation-heading">
            <div>
              <span>{customer?.name.slice(0, 1)}</span>
              <div>
                <strong>{customer?.name}</strong>
                <small>{customer?.phone}</small>
              </div>
            </div>
            <em>{loading ? "Elaborazione…" : "Pronto"}</em>
          </div>

          <div
            aria-busy={loading}
            aria-live="polite"
            className="voice-messages"
          >
            {messages.length === 0 ? (
              <div className="voice-empty">
                <span><HeadsetIcon /></span>
                <h2>Inizia dicendo “Vorrei prenotare”</h2>
                <p>
                  Puoi parlare oppure scrivere. Le risposte vengono anche
                  lette ad alta voce.
                </p>
              </div>
            ) : (
              messages.map((message) => (
                <article className={message.role} key={message.id}>
                  <small>
                    {message.role === "customer" ? "Cliente" : "Assistente"}
                  </small>
                  <p>{message.text}</p>
                </article>
              ))
            )}
          </div>

          {feedback ? <p className="form-error">{feedback}</p> : null}

          <form
            className="voice-text-input"
            onSubmit={(event) => {
              event.preventDefault();
              void sendMessage(draft);
            }}
          >
            <input
              aria-label="Messaggio per l’assistente"
              disabled={loading}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Oppure scrivi qui…"
              value={draft}
            />
            <button disabled={!draft.trim() || loading} type="submit">
              Invia
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}
