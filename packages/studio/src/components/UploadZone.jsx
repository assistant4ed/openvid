"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getUploadSpec, validateUpload } from "../utils/uploadSpec.js";

// A dropzone that states its own rules. Formats and size limits are printed on
// the panel rather than discovered by failing an upload, and the same spec
// object drives the validator, so the two can never disagree.
//
// Emits a data URL. Callers that need a fetchable URL (video start frames) pass
// it through /api/asset.

export default function UploadZone({
  kind = "image",
  value,
  onChange,
  onError,
  guidance,
  title,
  compact = false,
  disabled = false,
}) {
  const spec = getUploadSpec(kind);
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isReading, setIsReading] = useState(false);

  const readFile = useCallback(
    (file) => {
      const problem = validateUpload(file, kind);
      if (problem) {
        onError?.(problem);
        return;
      }
      setIsReading(true);
      const reader = new FileReader();
      reader.onload = () => {
        setIsReading(false);
        onChange?.(reader.result, file);
      };
      reader.onerror = () => {
        setIsReading(false);
        onError?.("That file could not be read. Try another.");
      };
      reader.readAsDataURL(file);
    },
    [kind, onChange, onError],
  );

  // Paste-to-upload: the fastest path from a screenshot to a shot.
  useEffect(() => {
    if (disabled) return undefined;
    const handlePaste = (event) => {
      const file = [...(event.clipboardData?.files || [])][0];
      if (file) readFile(file);
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [disabled, readFile]);

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    const file = event.dataTransfer.files?.[0];
    if (file) readFile(file);
  };

  if (value) {
    return (
      <div className={`relative overflow-hidden rounded-xl border border-white/[0.1] bg-black/40 ${compact ? "h-28" : "h-44"}`}>
        {kind === "image" ? (
          <img src={value} alt="Uploaded source" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="slate-value">{spec.label.toUpperCase()} READY</span>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/85 to-transparent px-3 py-2">
          <span className="slate-label" style={{ color: "rgba(255,255,255,0.75)" }}>
            SOURCE LOADED
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange?.(null, null)}
            className="rounded-md border border-white/15 bg-black/60 px-2 py-1 font-slate text-[10px] uppercase tracking-[0.14em] text-white/70 transition-colors hover:border-white/35 hover:text-white disabled:opacity-40"
          >
            Replace
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={spec.accept}
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) readFile(file);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled || isReading}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 text-center transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
          compact ? "h-28" : "h-44"
        } ${
          isDragging
            ? "border-[#d4f939] bg-[#d4f939]/[0.07]"
            : "border-white/15 bg-white/[0.02] hover:border-white/30 hover:bg-white/[0.04]"
        }`}
      >
        {isReading ? (
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#d4f939]/25 border-t-[#d4f939]" />
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-white/40" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="M7 9l5-5 5 5" />
            <path d="M12 4v12" />
          </svg>
        )}
        <span className="font-display text-sm tracking-tight text-white">
          {title || `Upload ${spec.label}`}
        </span>
        {/* The rules, stated up front. */}
        <span className="slate-label">{spec.spec}</span>
        <span className="text-[11px] text-white/35">Click, drag &amp; drop, or paste</span>
      </button>
      <p className="mt-2 text-[11px] leading-relaxed text-white/35">
        {guidance || spec.hint}
      </p>
    </div>
  );
}
