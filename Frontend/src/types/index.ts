// Domain model for the CRM. One file per aggregate; import from "@/types".
//
// These shapes are the contract the backend will have to satisfy — when the
// Supabase schema lands, generated row types should be mapped onto these
// rather than replacing them, so the UI stays independent of the transport.
export * from "./lead";
export * from "./meeting";
export * from "./notification";
export * from "./proposal";
export * from "./task";
export * from "./timeline";
export * from "./user";
export * from "./workflow";
