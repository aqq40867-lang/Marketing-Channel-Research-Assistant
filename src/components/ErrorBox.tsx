import type { AppError } from "@/lib/types";

export function ErrorBox({ error, onRetry, retryLabel = "Retry" }: { error: AppError; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm">
      <p className="font-medium text-red-700">{error.message}</p>
      <p className="mt-1 text-red-600">Next step: {error.suggestion}</p>
      {onRetry && (
        <button className="btn-danger mt-3" onClick={onRetry}>{retryLabel}</button>
      )}
    </div>
  );
}
