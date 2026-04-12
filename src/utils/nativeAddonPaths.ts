import fs from 'fs';
import path from 'path';

const ADDON_BASENAME = 'polymarket_token_price_fetch';

/** Same triplet as Node: `darwin-arm64`, `linux-x64`, `win32-x64`, … */
export function nodePlatformArchTriplet(platform = process.platform, arch = process.arch): string {
    return `${platform}-${arch}`;
}

/**
 * Ordered search paths for the native addon (absolute).
 * Prefer `node/prebuilds/<platform>-<arch>/` then legacy folders.
 */
export function resolveNativeAddonCandidatePaths(projectRoot: string): string[] {
    const t = nodePlatformArchTriplet();
    const out: string[] = [];
    const push = (p: string) => {
        if (!out.includes(p)) {
            out.push(p);
        }
    };

    const pre = path.join(projectRoot, 'node', 'prebuilds', t);
    push(path.join(pre, `${ADDON_BASENAME}.node`));
    if (process.platform === 'win32') {
        push(path.join(pre, `${ADDON_BASENAME}.dll`));
    }

    if (process.platform === 'win32') {
        push(path.join(projectRoot, 'node', 'windows', `${ADDON_BASENAME}.dll`));
    } else if (process.platform === 'darwin') {
        push(path.join(projectRoot, 'node', 'macos', `${ADDON_BASENAME}.node`));
        push(
            path.join(
                projectRoot,
                'node',
                `darwin-${process.arch}`,
                `${ADDON_BASENAME}.node`,
            ),
        );
    } else {
        push(path.join(projectRoot, 'node', 'linux', `${ADDON_BASENAME}.node`));
        push(
            path.join(
                projectRoot,
                'node',
                `linux-${process.arch}`,
                `${ADDON_BASENAME}.node`,
            ),
        );
    }

    return out;
}

/** ELF64: file smaller than section header table offset → mmap SIGBUS on Linux if loaded. */
function elf64LooksTruncated(absPath: string, size: number): boolean {
    const fd = fs.openSync(absPath, 'r');
    try {
        const buf = Buffer.alloc(64);
        if (fs.readSync(fd, buf, 0, 64, 0) < 64) {
            return true;
        }
        if (buf[0] !== 0x7f || buf.toString('ascii', 1, 4) !== 'ELF' || buf[4] !== 2) {
            return false;
        }
        const eShoff = Number(buf.readBigUInt64LE(40));
        return size < eShoff + 64;
    } finally {
        fs.closeSync(fd);
    }
}

/** PE: section raw data extends past file end → corrupt / truncated DLL. */
function peLooksTruncated(absPath: string, size: number): boolean {
    const fd = fs.openSync(absPath, 'r');
    try {
        const dos = Buffer.alloc(64);
        if (fs.readSync(fd, dos, 0, 64, 0) < 64) {
            return true;
        }
        if (dos[0] !== 0x4d || dos[1] !== 0x5a) {
            return false;
        }
        const eLfanew = dos.readUInt32LE(0x3c);
        if (eLfanew < 0x40 || eLfanew > size - 24) {
            return true;
        }
        const pe = Buffer.alloc(24 + 256);
        const need = Math.min(pe.length, size - eLfanew);
        if (need < 24) {
            return true;
        }
        fs.readSync(fd, pe, 0, need, eLfanew);
        if (pe.toString('ascii', 0, 4) !== 'PE\0\0') {
            return false;
        }
        const numberOfSections = pe.readUInt16LE(6);
        const sizeOfOptionalHeader = pe.readUInt16LE(20);
        const sectionTableOffset = eLfanew + 24 + sizeOfOptionalHeader;
        if (sectionTableOffset + numberOfSections * 40 > size) {
            return true;
        }
        for (let i = 0; i < numberOfSections; i++) {
            const off = sectionTableOffset + i * 40;
            const sect = Buffer.alloc(40);
            if (fs.readSync(fd, sect, 0, 40, off) < 40) {
                return true;
            }
            const rawSize = sect.readUInt32LE(16);
            const rawPtr = sect.readUInt32LE(20);
            if (rawSize > 0 && rawPtr + rawSize > size) {
                return true;
            }
        }
        return false;
    } finally {
        fs.closeSync(fd);
    }
}

/**
 * If true, do not call `require()` / `dlopen` — truncated/corrupt native binaries can crash the process (e.g. SIGBUS on Linux).
 */
export function isNativeBinaryUnsafeToLoad(absPath: string): boolean {
    let st: fs.Stats;
    try {
        st = fs.statSync(absPath);
    } catch {
        return true;
    }
    const lower = absPath.toLowerCase();
    try {
        if (lower.endsWith('.dll') || lower.endsWith('.exe')) {
            return peLooksTruncated(absPath, st.size);
        }
        const fd = fs.openSync(absPath, 'r');
        try {
            const magic = Buffer.alloc(4);
            fs.readSync(fd, magic, 0, 4, 0);
            if (magic[0] === 0x7f && magic[1] === 0x45 && magic[2] === 0x4c && magic[3] === 0x46) {
                return elf64LooksTruncated(absPath, st.size);
            }
            if (magic[0] === 0x4d && magic[1] === 0x5a) {
                return peLooksTruncated(absPath, st.size);
            }
        } finally {
            fs.closeSync(fd);
        }
    } catch {
        return true;
    }
    return false;
}
