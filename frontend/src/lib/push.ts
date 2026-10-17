import { api } from "./api";

// Notificaciones push (Web Push). Necesitan HTTPS (o localhost) y, en iPhone,
// que la app esté instalada en la pantalla de inicio.

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration()) ?? navigator.serviceWorker.register("/sw.js");
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  return (await registration()).pushManager.getSubscription();
}

export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error("Este navegador no admite notificaciones. En iPhone, instala la app en la pantalla de inicio.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Has bloqueado las notificaciones. Actívalas en los ajustes del navegador.");
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const { key } = await api.pushKey();
  const sub =
    (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }));
  await api.pushSubscribe(sub.toJSON());
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.pushUnsubscribe(sub.toJSON());
  await sub.unsubscribe();
}
