const cloudflareStub = new URL("./cloudflare-workers-render-stub.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return { url: cloudflareStub, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
