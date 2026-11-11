"use client";
import type { ReactNode } from "react";

export function Modal({ open, title, children, onClose, actions }: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  actions: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <h3 className="mb-3 text-base font-semibold">{title}</h3>
        <div className="text-sm text-slate-700">{children}</div>
        <div className="mt-5 flex justify-end gap-2">{actions}</div>
      </div>
    </div>
  );
}
