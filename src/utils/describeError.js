// Logs the full Supabase/Postgres error (message, code, details, hint) for
// developers and returns a short, readable message safe to show a customer.
export function describeError(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback
  console.error('[checkout] request failed', {
    message: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint,
    status: error.status,
    error,
  })
  return error.message || fallback
}
