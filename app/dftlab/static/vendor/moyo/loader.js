// loader.js -- initialise the moyo WebAssembly module (moyo-wasm 0.21.0, MIT OR Apache-2.0).
//
// Works in three situations:
//   1. served over http(s): the .wasm file next to this script is fetched;
//   2. offline / file:// pages: pass the wasm bytes yourself (Uint8Array, ArrayBuffer,
//      base64 string, WebAssembly.Module), set `globalThis.MOYO_WASM_BASE64` before
//      calling, or call `initMoyo('inline')` to import the bundled base64 module
//      (moyo_wasm_inline.js, generated from moyo_wasm_bg.wasm);
//   3. Node.js (tests): the .wasm file is read from disk with node:fs.
//
// Usage:
//   import { initMoyo } from './moyo/loader.js';
//   const moyo = await initMoyo();            // or initMoyo(bytes) / initMoyo('inline')
//   moyo.analyze_cell(JSON.stringify(cell), 1e-5, 'Spglib');

import * as moyoWasm from './moyo_wasm.js';
import { initSync } from './moyo_wasm.js';

let ready = false;
let pending = null;

function base64ToBytes(b64) {
  const clean = b64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (typeof atob === 'function') {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // eslint-disable-next-line no-undef
  return new Uint8Array(Buffer.from(clean, 'base64'));
}

function isNode() {
  return typeof process !== 'undefined' && !!(process.versions && process.versions.node)
    && typeof window === 'undefined';
}

function looksLikeBase64(s) {
  return typeof s === 'string' && (s.startsWith('data:') || (s.length > 1000 && /^[A-Za-z0-9+/=\s]+$/.test(s.slice(0, 2000))));
}

async function resolveBytes(src) {
  if (src == null) {
    if (typeof globalThis !== 'undefined' && typeof globalThis.MOYO_WASM_BASE64 === 'string') {
      return base64ToBytes(globalThis.MOYO_WASM_BASE64);
    }
    const url = new URL('moyo_wasm_bg.wasm', import.meta.url);
    if (isNode() || url.protocol === 'file:') {
      if (isNode()) {
        const fs = await import('node:fs');
        return new Uint8Array(fs.readFileSync(url));
      }
      // file:// in a browser: fetch is usually blocked, fall back to the inline module
      return resolveBytes('inline');
    }
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`moyo: could not fetch ${url} (${resp.status})`);
    return new Uint8Array(await resp.arrayBuffer());
  }
  if (src === 'inline') {
    const mod = await import('./moyo_wasm_inline.js');
    return base64ToBytes(mod.default);
  }
  if (src instanceof WebAssembly.Module) return src;
  if (src instanceof Uint8Array) return src;
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  if (ArrayBuffer.isView(src)) return new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
  if (looksLikeBase64(src)) return base64ToBytes(src);
  if (typeof src === 'string' || src instanceof URL) {
    const url = new URL(String(src), import.meta.url);
    if (isNode() && url.protocol === 'file:') {
      const fs = await import('node:fs');
      return new Uint8Array(fs.readFileSync(url));
    }
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`moyo: could not fetch ${url} (${resp.status})`);
    return new Uint8Array(await resp.arrayBuffer());
  }
  throw new Error('moyo: unsupported wasm source');
}

/**
 * Initialise moyo once. `optionalBytes` may be undefined (auto), 'inline', a URL/path,
 * a base64 string (optionally a data: URI), an ArrayBuffer/typed array or a WebAssembly.Module.
 * Resolves to the moyo module namespace (analyze_cell, operations_from_number, ...).
 */
export async function initMoyo(optionalBytes) {
  if (ready) return moyoWasm;
  if (!pending) {
    pending = (async () => {
      const bytes = await resolveBytes(optionalBytes);
      initSync({ module: bytes });
      ready = true;
      return moyoWasm;
    })();
    pending.catch(() => { pending = null; });
  }
  return pending;
}

/** Synchronous initialisation when the bytes are already available. */
export function initMoyoSync(bytesOrBase64) {
  if (ready) return moyoWasm;
  const bytes = typeof bytesOrBase64 === 'string' ? base64ToBytes(bytesOrBase64) : bytesOrBase64;
  initSync({ module: bytes });
  ready = true;
  return moyoWasm;
}

export function isMoyoReady() {
  return ready;
}

/** The moyo namespace; throws if initMoyo() has not completed. */
export function getMoyo() {
  if (!ready) throw new Error('moyo is not initialised: await initMoyo() first');
  return moyoWasm;
}
