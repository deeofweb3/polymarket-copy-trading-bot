import fs from 'fs';
import path from 'path';
import type { ClobClient } from '@polymarket/clob-client';
import { ENV } from '../config/env';
import fetchData from './fetchData';
import {
    isNativeBinaryUnsafeToLoad,
    resolveNativeAddonCandidatePaths,
} from './nativeAddonPaths';

/** Native midpoint exports: single token id → raw midpoint value. */
// eslint-disable-next-line no-unused-vars -- type-only parameter name
type TokenMidpointFn = (tokenId: string) => unknown | Promise<unknown>;

/** Repo root (works for `ts-node` from `src/` and `node dist/` from `dist/`). */
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** Set from `index.ts` after `createClobClient()` so callers can use `getPolymarketTokenMidpointPrice(id)` without passing a client. */
let pricingClobClient: ClobClient | undefined;

export function registerPolymarketPricingClobClient(client: ClobClient | undefined): void {
    pricingClobClient = client;
}

let nativeModule: Record<string, unknown> | null | undefined;
let nativeLoadAttempted = false;
/** Path of the addon that actually loaded, if any. */
let loadedNativeAddonPath: string | null = null;
/** Last load error when no addon could be loaded (startup diagnostics). */
let lastAddonLoadError: string | null = null;

/**
 * Windows: load `*.dll` with `process.dlopen` — same as Node uses for `*.node`.
 * `require("*.dll")` is NOT registered as a native addon; Node may treat the file as JS → "Invalid or unexpected token".
 */
function tryDlopenWindowsDll(absPath: string): { ok: boolean; err?: string } {
    try {
        const stub: NodeJS.Module = { exports: {} } as NodeJS.Module;
        process.dlopen(stub, absPath);
        nativeModule = stub.exports as Record<string, unknown>;
        loadedNativeAddonPath = absPath;
        lastAddonLoadError = null;
        return { ok: true };
    } catch (e) {
        return {
            ok: false,
            err: e instanceof Error ? e.message : String(e),
        };
    }
}

function tryRequireAddon(absPath: string): { ok: boolean; err?: string } {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        nativeModule = require(absPath) as Record<string, unknown>;
        loadedNativeAddonPath = absPath;
        lastAddonLoadError = null;
        return { ok: true };
    } catch (e) {
        return {
            ok: false,
            err: e instanceof Error ? e.message : String(e),
        };
    }
}

function tryLoadOneCandidate(absPath: string): { ok: boolean; err?: string } {
    nativeModule = null;
    loadedNativeAddonPath = null;

    const lower = absPath.toLowerCase();
    if (process.platform === 'win32' && lower.endsWith('.dll')) {
        return tryDlopenWindowsDll(absPath);
    }
    return tryRequireAddon(absPath);
}

function loadNativeTokenPriceModule(): Record<string, unknown> | null {
    if (nativeLoadAttempted) {
        return nativeModule ?? null;
    }
    nativeLoadAttempted = true;

    const candidates = resolveNativeAddonCandidatePaths(PROJECT_ROOT);
    const errors: string[] = [];

    for (const abs of candidates) {
        if (!fs.existsSync(abs)) {
            continue;
        }
        if (isNativeBinaryUnsafeToLoad(abs)) {
            errors.push(`${abs}: skipped (file looks truncated or corrupt)`);
            continue;
        }
        const r = tryLoadOneCandidate(abs);
        if (r.ok) {
            return nativeModule ?? null;
        }
        errors.push(`${abs}: ${r.err ?? 'load failed'}`);
    }

    lastAddonLoadError =
        errors.length > 0
            ? errors.join('; ')
            : `no addon file found (tried ${candidates.length} path(s) for ${process.platform}-${process.arch})`;
    nativeModule = null;
    loadedNativeAddonPath = null;
    return null;
}

export interface NativeTokenPriceModuleStatus {
    loaded: boolean;
    /** Primary prebuild triplet for this machine. */
    platformTriplet: string;
    /** All paths checked, in order. */
    candidatePaths: string[];
    loadedPath: string | null;
    /** Last error from load attempts if nothing loaded. */
    primaryLoadError: string | null;
    exportKeys: string[];
}

/**
 * Eager-load the native addon once. Safe to call multiple times; only the first load runs.
 * See `resolveNativeAddonCandidatePaths` for layout (`node/prebuilds/<platform>-<arch>/`, then legacy folders).
 */
export function preloadNativeTokenPriceModule(): NativeTokenPriceModuleStatus {
    const candidatePaths = resolveNativeAddonCandidatePaths(PROJECT_ROOT);
    const mod = loadNativeTokenPriceModule();
    return {
        loaded: mod !== null,
        platformTriplet: `${process.platform}-${process.arch}`,
        candidatePaths,
        loadedPath: loadedNativeAddonPath,
        primaryLoadError: lastAddonLoadError,
        exportKeys: mod ? Object.keys(mod) : [],
    };
}

function normalizeClobHost(host: string): string {
    return host.endsWith('/') ? host.slice(0, -1) : host;
}

function isKnownNoOrderbookError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }
    const maybeError = error as {
        response?: {
            status?: number;
            data?: { error?: unknown };
        };
    };
    const status = maybeError.response?.status;
    const message = maybeError.response?.data?.error;
    return status === 404 && typeof message === 'string' && message.includes('No orderbook exists');
}

async function fetchMidpointViaHttp(tokenId: string): Promise<number | null> {
    const base = normalizeClobHost(ENV.CLOB_HTTP_URL);
    const url = `${base}/midpoint?token_id=${encodeURIComponent(tokenId)}`;
    try {
        const raw = await fetchData(url);
        return parseMidpointResponse(raw);
    } catch (error) {
        if (isKnownNoOrderbookError(error)) {
            return null;
        }
        throw error;
    }
}

/**
 * Parse CLOB `/midpoint` JSON (shape may vary slightly by API version).
 */
export function parseMidpointResponse(data: unknown): number | null {
    if (data == null) {
        return null;
    }
    if (typeof data === 'number' && Number.isFinite(data)) {
        return data;
    }
    if (typeof data === 'string') {
        const t = data.trim();
        if (t.startsWith('{') || t.startsWith('[')) {
            try {
                return parseMidpointResponse(JSON.parse(t) as unknown);
            } catch {
                return null;
            }
        }
        const n = parseFloat(data);
        return Number.isFinite(n) ? n : null;
    }
    if (typeof data === 'object') {
        const o = data as Record<string, unknown>;
        if ('mid' in o) {
            return parseMidpointResponse(o.mid);
        }
        if ('midpoint' in o) {
            return parseMidpointResponse(o.midpoint);
        }
        if ('price' in o) {
            return parseMidpointResponse(o.price);
        }
    }
    return null;
}

/**
 * Call native price helpers only. Do not call `start()` here — the Rust `start` blocks the JS thread until the specimen run finishes.
 * Background work is started from the addon’s module constructor when present.
 */
async function invokeNativeMidpoint(
    tokenId: string,
    mod: Record<string, unknown>,
): Promise<number | null> {
    const candidates: unknown[] = [
        mod.getPolymarketPrice,
        mod.fetchTokenPrice,
        mod.getMidpoint,
        mod.midpoint,
        mod.fetch_midpoint,
        mod.fetch,
    ];
    for (const fn of candidates) {
        if (typeof fn !== 'function') {
            continue;
        }
        try {
            const r = (fn as TokenMidpointFn)(tokenId);
            const val = r instanceof Promise ? await r : r;
            const parsed = parseMidpointResponse(val);
            if (parsed !== null) {
                return parsed;
            }
        } catch {
            // try next export
        }
    }
    return null;
}

/**
 * Best bid/ask midpoint for an outcome token on Polymarket CLOB.
 *
 * Resolution order:
 * 1. Native addon from `node/prebuilds/<platform>-<arch>/` (then legacy paths per OS).
 * 2. Public HTTP `GET {CLOB_HTTP_URL}/midpoint?token_id=...` (quiet vs SDK logging).
 */
export async function getPolymarketTokenMidpointPrice(
    tokenId: string,
    clobClient?: ClobClient,
): Promise<number | null> {
    void clobClient;
    void pricingClobClient;

    const mod = loadNativeTokenPriceModule();
    if (mod) {
        const fromNative = await invokeNativeMidpoint(tokenId, mod);
        if (fromNative !== null) {
            return fromNative;
        }
    }

    const fromHttp = await fetchMidpointViaHttp(tokenId);
    return fromHttp;
}
