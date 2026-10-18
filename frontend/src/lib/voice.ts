import { useCallback, useEffect, useRef, useState } from "react";

// Voz con lo que trae el navegador (gratis, sin enviar audio a terceros salvo el
// reconocimiento de Chrome/Safari): dictado en español, respuesta en voz alta y el
// volumen del micro para que el núcleo de Jarvis reaccione al hablar.

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

const RecognitionCtor: (new () => Recognition) | undefined =
  typeof window !== "undefined"
    ? (((window as unknown as Record<string, unknown>).SpeechRecognition as never) ??
      ((window as unknown as Record<string, unknown>).webkitSpeechRecognition as never))
    : undefined;

const SPEAK_KEY = "jarvis:voz";
const IOS =
  typeof navigator !== "undefined" && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

export function readAloudPref(): boolean {
  try {
    return localStorage.getItem(SPEAK_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setReadAloudPref(on: boolean) {
  try {
    localStorage.setItem(SPEAK_KEY, on ? "1" : "0");
  } catch {
    /* sin almacenamiento: solo dura esta visita */
  }
}

/** La mejor voz en español disponible (las «naturales» o de Google suenan mucho mejor). */
function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const es = voices.filter((v) => v.lang.toLowerCase().startsWith("es"));
  const rank = (v: SpeechSynthesisVoice) =>
    (v.lang.toLowerCase() === "es-es" ? 4 : 0) +
    (/natural|neural|premium|enhanced|mejorad/i.test(v.name) ? 3 : 0) +
    (/google/i.test(v.name) ? 2 : 0) +
    (/m[oó]nica|jorge|paulina|elvira|alvaro/i.test(v.name) ? 1 : 0);
  return es.sort((a, b) => rank(b) - rank(a))[0];
}

/** Limpia el markdown para que suene natural al leerlo. */
function forSpeech(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_#>`|]/g, "")
    .replace(/^\s*[-•]\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function useVoice({ onFinal }: { onFinal: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const level = useRef(0);
  const rec = useRef<Recognition | null>(null);
  const finalText = useRef("");
  const audio = useRef<{ ctx: AudioContext; stream: MediaStream; raf: number } | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const supported = !!RecognitionCtor;
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

  const stopMeter = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    cancelAnimationFrame(a.raf);
    a.stream.getTracks().forEach((t) => t.stop());
    a.ctx.close().catch(() => {});
    audio.current = null;
    level.current = 0;
  }, []);

  const startMeter = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        level.current = Math.min(1, Math.sqrt(sum / data.length) * 4);
        if (audio.current) audio.current.raf = requestAnimationFrame(tick);
      };
      audio.current = { ctx, stream, raf: requestAnimationFrame(tick) };
    } catch {
      /* sin permiso de micro para el medidor: el núcleo se anima igual */
    }
  }, []);

  const stop = useCallback(() => {
    rec.current?.stop();
  }, []);

  const start = useCallback(() => {
    if (!RecognitionCtor || rec.current) return;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    setError(null);
    finalText.current = "";
    setInterim("");
    const r = new RecognitionCtor();
    r.lang = "es-ES";
    r.continuous = false;
    r.interimResults = true;
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText.current += res[0].transcript;
        else live += res[0].transcript;
      }
      setInterim((finalText.current + live).trim());
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed")
        setError(
          IOS ? "Safari no tiene permiso para el micrófono: Ajustes › Apps › Safari › Micrófono › Permitir." : "Permite el micrófono para hablar con Jarvis.",
        );
      else if (e.error === "service-not-allowed")
        setError(
          IOS
            ? "Activa el Dictado del iPhone (Ajustes › General › Teclado › Activar Dictado). Mientras, puedes dictar con el micro del teclado."
            : "El navegador no deja usar el reconocimiento de voz aquí. Prueba en Chrome o Safari.",
        );
      else if (e.error === "audio-capture") setError("No encuentro ningún micrófono.");
      else if (e.error === "network") setError("El reconocimiento de voz necesita conexión a Internet.");
      else if (e.error !== "no-speech" && e.error !== "aborted") setError("No te he entendido. Prueba otra vez.");
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
      stopMeter();
      const text = finalText.current.trim();
      setInterim("");
      if (text) onFinalRef.current(text);
    };
    rec.current = r;
    setListening(true);
    // En iPhone abrir el micro dos veces (dictado + medidor) hace fallar el dictado.
    if (!IOS) startMeter();
    try {
      r.start();
    } catch {
      rec.current = null;
      setListening(false);
    }
  }, [startMeter, stopMeter]);

  const speak = useCallback(
    (text: string) => {
      if (!canSpeak) return;
      const clean = forSpeech(text);
      if (!clean) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(clean.slice(0, 1200));
      u.lang = "es-ES";
      const voice = pickVoice();
      if (voice) u.voice = voice;
      u.rate = 1.04;
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    },
    [canSpeak],
  );

  const silence = useCallback(() => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  useEffect(() => {
    // Algunas voces se cargan tarde.
    window.speechSynthesis?.getVoices();
    return () => {
      rec.current?.abort();
      stopMeter();
      window.speechSynthesis?.cancel();
    };
  }, [stopMeter]);

  return { supported, canSpeak, listening, speaking, interim, error, level, start, stop, speak, silence };
}
