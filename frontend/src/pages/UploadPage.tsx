import { Camera, CloudUpload, Loader2 } from "lucide-react";
import { useRef, useState } from "react";

import { api, type Item } from "../api";
import ItemCard from "../components/ItemCard";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.docx,.txt,.md,.csv,.eml";

export default function UploadPage() {
  const [uploaded, setUploaded] = useState<Item[]>([]);
  const [duplicates, setDuplicates] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const send = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.upload(Array.from(files));
      setUploaded((prev) => [...result.created, ...prev]);
      setDuplicates(result.duplicates);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          send(e.dataTransfer.files);
        }}
        onClick={() => fileInput.current?.click()}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center ${
          dragging ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10" : "border-slate-300 dark:border-slate-700"
        }`}
      >
        {busy ? <Loader2 className="animate-spin text-indigo-600" size={36} /> : <CloudUpload className="text-indigo-600" size={36} />}
        <p className="font-medium">{busy ? "Subiendo…" : "Arrastra archivos o toca para elegir"}</p>
        <p className="text-sm text-slate-500">PDF, fotos, Word o texto. Se leen y clasifican solos.</p>
      </div>

      <button
        onClick={() => cameraInput.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 py-3 font-medium text-white"
      >
        <Camera size={20} /> Hacer una foto
      </button>

      <input ref={fileInput} type="file" multiple accept={ACCEPT} hidden onChange={(e) => send(e.target.files)} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => send(e.target.files)} />

      {error && <p className="text-sm text-red-600">{error}</p>}
      {duplicates.length > 0 && <p className="text-sm text-slate-500">Ya los tenías: {duplicates.join(", ")}</p>}
      {uploaded.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Recién subidos</h2>
          {uploaded.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
          <p className="text-xs text-slate-500">Se están procesando; en la lista de documentos verás su categoría en unos segundos.</p>
        </section>
      )}
    </div>
  );
}
