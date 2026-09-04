// The production bundle imports this object as `env` from `cloudflare:workers`.
// The Render entrypoint fills it with Node-backed D1/R2-compatible bindings before
// importing the bundle, so every server module observes the same live object.
export const env = {};
