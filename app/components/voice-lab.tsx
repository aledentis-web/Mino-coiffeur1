"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { syntheticCustomers } from "../lib/seed";
import { ArrowUpRight, HeadsetIcon, PhoneIcon } from "./icons";

const MAX_RECORDING_DURATION_MS = 20_000;
const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/webm"
];

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
  const [transcribing, setTranscribing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const busy = transcribing || loading;

  useEffect(() => {
    return () => {
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
      }
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
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

  function stopMediaStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function preferredRecordingMimeType() {
    return RECORDING_MIME_TYPES.find((type) =>
      MediaRecorder.isTypeSupported(type)
    );
  }

  async function transcribeRecording(recording: Blob) {
    setTranscribing(true);
    setFeedback("");

    try {
      const formData = new FormData();
      formData.set(
        "audio",
        recording,
        recording.type.includes("mp4")
          ? "studio-barber-voice.m4a"
          : "studio-barber-voice.webm"
      );
      const response = await fetch("/api/admin/assistant/transcribe", {
        method: "POST",
        body: formData
      });
      const payload = (await response.json()) as {
        text?: string;
        error?: string;
      };

      if (response.status === 401) {
        window.location.assign("/admin/login");
        return;
      }
      if (!response.ok || !payload.text) {
        throw new Error(
          payload.error ?? "La trascrizione non ha restituito del testo."
        );
      }

      await sendMessage(payload.text);
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Non sono riuscito a trascrivere l’audio."
      );
    } finally {
      setTranscribing(false);
    }
  }

  async function startListening() {
    setFeedback("");
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setFeedback(
        "La registrazione vocale non è disponibile in questo browser. Puoi comunque scrivere il messaggio."
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = preferredRecordingMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setFeedback("La registrazione si è interrotta. Riprova.");
        setListening(false);
        stopMediaStream();
      };
      recorder.onstop = () => {
        if (recordingTimeoutRef.current) {
          clearTimeout(recordingTimeoutRef.current);
          recordingTimeoutRef.current = null;
        }
        const chunks = chunksRef.current;
        chunksRef.current = [];
        recorderRef.current = null;
        const recording = new Blob(chunks, {
          type: recorder.mimeType || mimeType || "audio/webm"
        });
        stopMediaStream();
        setListening(false);
        if (recording.size > 0) void transcribeRecording(recording);
        else setFeedback("La registrazione è vuota. Riprova.");
      };

      recorder.start();
      setListening(true);
      recordingTimeoutRef.current = setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, MAX_RECORDING_DURATION_MS);
    } catch (error) {
      stopMediaStream();
      setListening(false);
      setFeedback(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Permesso microfono negato. Abilitalo nelle impostazioni del browser."
          : "Non riesco ad accedere al microfono. Riprova."
      );
    }
  }

  function stopListening() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }

  function changeCustomer(nextCustomerId: string) {
    window.speechSynthesis?.cancel();
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
            Parla dal browser: OpenAI trascrive l’audio e lo stesso motore di
            WhatsApp aggiorna l’agenda.
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
              disabled={busy || listening}
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
            disabled={busy}
            onClick={
              listening
                ? stopListening
                : () => {
                    void startListening();
                  }
            }
            type="button"
          >
            <span><PhoneIcon /></span>
            <strong>
              {transcribing
                ? "Trascrizione in corso…"
                : listening
                  ? "Sto registrando…"
                  : "Parla con l’assistente"}
            </strong>
            <small>
              {transcribing
                ? "OpenAI sta trasformando l’audio in testo"
                : listening
                ? "Premi per interrompere"
                : "Massimo 20 secondi per ogni messaggio"}
            </small>
          </button>

          <div className="voice-security-note">
            <strong>Test protetto</strong>
            <p>
              L’endpoint è accessibile solo dalla sessione amministratore.
              Le chiavi OpenAI e Supabase restano esclusivamente sul server.
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
            <em>
              {transcribing
                ? "Trascrizione…"
                : loading
                  ? "Elaborazione…"
                  : listening
                    ? "Registrazione…"
                    : "Pronto"}
            </em>
          </div>

          <div
            aria-busy={busy}
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
              disabled={busy || listening}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Oppure scrivi qui…"
              value={draft}
            />
            <button
              disabled={!draft.trim() || busy || listening}
              type="submit"
            >
              Invia
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}
