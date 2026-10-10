// Types the checked JavaScript relies on but that no file declares
// (jsconfig.json, `npm run typecheck`). Hand-written; there is no build.

// The browser builds of the pure modules hang themselves on window:
// js/i18n.js, js/room-plan.js, js/bathroom-pricing.js, js/materials-pricing.js,
// js/surface-finishes.js, js/net.js.
declare var I18n: any;
declare var RoomPlan: any;
declare var BathroomPricing: any;
declare var MaterialsPricing: any;
declare var SurfaceFinishes: any;
declare var Net: any;

// Browser-only globals: js/estimate-pdf.js hangs itself on window and loads
// the vendored jsPDF (js/vendor/jspdf.umd.min.js) on demand, which sets
// window.jspdf.
interface Window {
  jspdf?: any;
  EstimatePdf?: any;
}

// Errors are tagged where they are thrown so the caller can say what
// happened: api/_lib.js sets `upstream` on a Supabase/Stripe failure;
// js/net.js sets kind/status/code/data (see its header).
interface Error {
  upstream?: boolean;
  timedOut?: boolean;
  kind?: string;
  status?: number;
  retryAfterMs?: number;
  code?: string;
  data?: any;
}
