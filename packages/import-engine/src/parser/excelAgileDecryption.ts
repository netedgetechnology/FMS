/// <reference path="./jsShaShims.d.ts" />
// Decrypts a password-protected .xlsx file using ECMA-376 Agile
// Encryption ([MS-OFFCRYPTO] 2.3.4.10) - the scheme modern Excel
// ("Encrypt with Password") produces by default, and the one the
// installed xlsx@0.18.5 (SheetJS Community Edition) build can detect
// but never actually decrypt (no decrypt_agile routine in that build -
// see excelParser.ts's classifyExcelReadError).
//
// Uses:
//   - `cfb` (already an existing transitive dependency of xlsx, made
//     explicit here) to read the OLE2/Compound File Binary container
//     and pull out its /EncryptionInfo and /EncryptedPackage streams.
//   - `js-sha1`/`js-sha256`/`js-sha512` for the password->key spin-hash
//     derivation (2.3.4.11) - Web Crypto's SubtleCrypto.digest was
//     measured (against this exact spinCount=100000 workload) at ~29s
//     for 100k sequential calls, vs ~3s for these synchronous, pure-JS
//     implementations - SubtleCrypto's per-call dispatch overhead makes
//     it unusable for an iterated hash like this.
//   - Web Crypto's SubtleCrypto AES-CBC for the actual block decryption
//     (native, fast, and the one part of this workload - a handful of
//     large blocks, not 100k tiny ones - where it's the right tool).
//
// No XML parser dependency: the /EncryptionInfo XML has a small, fixed,
// non-nested structure (see parseAgileEncryptionInfo below) that a
// small regex-based attribute extractor handles reliably, and - unlike
// DOMParser - works identically under Node (this package's vitest
// suite) and the browser/WebView (the real desktop app), with no
// environment-specific branching.

// Default imports (never `import { X } from "..."` or `import * as X`)
// for every one of these CJS packages - the one form Vite/esbuild's
// dev-server CJS->ESM conversion is guaranteed to bind to the whole,
// original `module.exports` value for ALL of them, regardless of which
// bundling strategy esbuild happened to pick for a given package.
// Verified against the actual pre-bundled output (`node_modules/.vite/
// deps/*.js`): cfb/js-sha1/js-sha512 are wrapped as `export default
// require_x()` (opaque CJS - only `default` is meaningful), while
// js-sha256 is instead statically re-exported as `export { core_default
// as default, sha224, sha256 }` (esbuild found real static structure) -
// a DIFFERENT strategy for what is, at runtime, an identical shape:
// module.exports is a callable hash function with .create/.sha256/
// .sha224/.hmac attached as ordinary properties. A named import
// (`import { create } from "js-sha256"`) or namespace import
// (`import * as X from "js-sha256"`) only sees whatever esbuild
// statically discovered - `default`/`sha224`/`sha256` - never the
// dynamically-attached `.create`, and throws
// "does not provide an export named 'create'" at module-link time in
// the real browser/WebView runtime (reproduced against the actual dev
// server - this exact mismatch was the blank-app root cause). Only
// `default` is guaranteed, for either bundling strategy, to be the
// complete original object with every property still attached.
import CFB from "cfb";
import sha1Module from "js-sha1";
import sha256Module from "js-sha256";
import sha512Module from "js-sha512";

import { ExcelPasswordError } from "./excelParser";

const UNSUPPORTED_PROTECTION_MESSAGE =
    "This file's password protection isn't supported. Please save an unprotected copy and try again.";

interface StreamingHasher {
    update(data: Uint8Array): StreamingHasher;
    arrayBuffer(): ArrayBuffer;
}

function createHasher(algorithm: string): StreamingHasher {
    switch (algorithm.toUpperCase()) {
        case "SHA1":
            return sha1Module.create();
        case "SHA256":
            return sha256Module.create();
        case "SHA384":
            return sha512Module.sha384.create();
        case "SHA512":
            return sha512Module.create();
        default:
            throw new ExcelPasswordError(
                "unsupported",
                UNSUPPORTED_PROTECTION_MESSAGE
            );
    }
}

function hash(
    algorithm: string,
    ...parts: Uint8Array[]
): Uint8Array {
    const hasher = createHasher(algorithm);

    for (const part of parts) {
        hasher.update(part);
    }

    return new Uint8Array(hasher.arrayBuffer());
}

function uint32LE(value: number): Uint8Array {
    const buffer = new Uint8Array(4);
    new DataView(buffer.buffer).setUint32(
        0,
        value,
        true
    );
    return buffer;
}

function utf16leBytes(text: string): Uint8Array {
    const bytes = new Uint8Array(text.length * 2);
    const view = new DataView(bytes.buffer);

    for (
        let index = 0;
        index < text.length;
        index += 1
    ) {
        view.setUint16(
            index * 2,
            text.charCodeAt(index),
            true
        );
    }

    return bytes;
}

function concatBytes(
    ...parts: Uint8Array[]
): Uint8Array {
    const total = parts.reduce(
        (sum, part) => sum + part.length,
        0
    );

    const out = new Uint8Array(total);
    let offset = 0;

    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }

    return out;
}

function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (
        let index = 0;
        index < binary.length;
        index += 1
    ) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
}

// Pads/truncates `key` to exactly `byteLength` bytes, per
// [MS-OFFCRYPTO] 2.3.4.9/2.3.4.11's key-derivation padding rule: keep
// the real hash bytes at the start, fill any remaining bytes with
// 0x36.
function fitToLength(
    key: Uint8Array,
    byteLength: number
): Uint8Array {
    if (key.length === byteLength) {
        return key;
    }

    if (key.length > byteLength) {
        return key.slice(0, byteLength);
    }

    const padded = new Uint8Array(byteLength).fill(
        0x36
    );
    padded.set(key, 0);
    return padded;
}

// Pads `hashValue` up to `byteLength` with ZERO bytes (never 0x36 -
// that padding is specific to fitToLength's key/IV derivation rule
// above). The decrypted encryptedVerifierHashValue is itself
// zero-padded out to a full cipher block when it was created (a raw
// SHA-1/256/384/512 digest is rarely already block-aligned), so the
// freshly-computed comparison hash must be padded the exact same way -
// using 0x36 here would make every correct password look wrong.
function padWithZeros(
    hashValue: Uint8Array,
    byteLength: number
): Uint8Array {
    if (hashValue.length >= byteLength) {
        return hashValue.slice(0, byteLength);
    }

    const padded = new Uint8Array(byteLength);
    padded.set(hashValue, 0);
    return padded;
}

// --- /EncryptionInfo XML parsing (regex-based - see file header) ---

interface AgileKeyEncryptorInfo {
    saltValue: Uint8Array;
    hashAlgorithm: string;
    keyBits: number;
    spinCount: number;
    cipherAlgorithm: string;
    cipherChaining: string;
    encryptedVerifierHashInput: Uint8Array;
    encryptedVerifierHashValue: Uint8Array;
    encryptedKeyValue: Uint8Array;
}

interface AgilePackageInfo {
    saltValue: Uint8Array;
    hashAlgorithm: string;
    blockSize: number;
    cipherAlgorithm: string;
    cipherChaining: string;
}

interface AgileEncryptionInfo {
    package: AgilePackageInfo;
    key: AgileKeyEncryptorInfo;
}

function extractAttributes(
    xml: string,
    tagName: string
): Record<string, string> {
    // Tolerant of an XML namespace prefix (e.g. "p:encryptedKey") and
    // either a self-closing or open tag.
    const tagPattern = new RegExp(
        `<(?:\\w+:)?${tagName}\\b([^>]*)/?>`,
        "i"
    );

    const tagMatch = xml.match(tagPattern);

    if (!tagMatch) {
        throw new ExcelPasswordError(
            "unsupported",
            UNSUPPORTED_PROTECTION_MESSAGE
        );
    }

    const attributes: Record<string, string> = {};
    const attributePattern =
        /([\w:.-]+)\s*=\s*"([^"]*)"/g;

    let attributeMatch: RegExpExecArray | null;

    while (
        (attributeMatch =
            attributePattern.exec(tagMatch[1])) !== null
    ) {
        attributes[attributeMatch[1]] =
            attributeMatch[2];
    }

    return attributes;
}

function requireAttribute(
    attributes: Record<string, string>,
    name: string
): string {
    const value = attributes[name];

    if (value === undefined) {
        throw new ExcelPasswordError(
            "unsupported",
            UNSUPPORTED_PROTECTION_MESSAGE
        );
    }

    return value;
}

function parseAgileEncryptionInfoXml(
    xml: string
): AgileEncryptionInfo {
    const keyData = extractAttributes(
        xml,
        "keyData"
    );

    const encryptedKey = extractAttributes(
        xml,
        "encryptedKey"
    );

    return {
        package: {
            saltValue: base64ToBytes(
                requireAttribute(
                    keyData,
                    "saltValue"
                )
            ),
            hashAlgorithm: requireAttribute(
                keyData,
                "hashAlgorithm"
            ),
            blockSize: Number(
                requireAttribute(
                    keyData,
                    "blockSize"
                )
            ),
            cipherAlgorithm: requireAttribute(
                keyData,
                "cipherAlgorithm"
            ),
            cipherChaining: requireAttribute(
                keyData,
                "cipherChaining"
            ),
        },
        key: {
            saltValue: base64ToBytes(
                requireAttribute(
                    encryptedKey,
                    "saltValue"
                )
            ),
            hashAlgorithm: requireAttribute(
                encryptedKey,
                "hashAlgorithm"
            ),
            keyBits: Number(
                requireAttribute(
                    encryptedKey,
                    "keyBits"
                )
            ),
            spinCount: Number(
                requireAttribute(
                    encryptedKey,
                    "spinCount"
                )
            ),
            cipherAlgorithm: requireAttribute(
                encryptedKey,
                "cipherAlgorithm"
            ),
            cipherChaining: requireAttribute(
                encryptedKey,
                "cipherChaining"
            ),
            encryptedVerifierHashInput:
                base64ToBytes(
                    requireAttribute(
                        encryptedKey,
                        "encryptedVerifierHashInput"
                    )
                ),
            encryptedVerifierHashValue:
                base64ToBytes(
                    requireAttribute(
                        encryptedKey,
                        "encryptedVerifierHashValue"
                    )
                ),
            encryptedKeyValue: base64ToBytes(
                requireAttribute(
                    encryptedKey,
                    "encryptedKeyValue"
                )
            ),
        },
    };
}

// The /EncryptionInfo stream is an 8-byte header (VersionMajor u16le,
// VersionMinor u16le, Flags u32le) followed by the XML above - see
// [MS-OFFCRYPTO] 2.3.4.1/2.3.4.10.
const ENCRYPTION_INFO_HEADER_LENGTH = 8;

function readEncryptionInfoHeader(
    content: Uint8Array
): { versionMajor: number; versionMinor: number } {
    const view = new DataView(
        content.buffer,
        content.byteOffset,
        content.byteLength
    );

    return {
        versionMajor: view.getUint16(0, true),
        versionMinor: view.getUint16(2, true),
    };
}

// --- Password -> key derivation ([MS-OFFCRYPTO] 2.3.4.11/2.3.4.12) ---

// The three fixed "block key" byte constants Agile Encryption appends
// before the final hash, one per purpose - see [MS-OFFCRYPTO]
// 2.3.4.7/2.3.4.9. Values verified against a real ECMA-376 Agile
// Encryption implementation's source.
const BLOCK_KEY_VERIFIER_HASH_INPUT = new Uint8Array([
    0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79,
]);

const BLOCK_KEY_VERIFIER_HASH_VALUE = new Uint8Array([
    0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e,
]);

const BLOCK_KEY_KEY = new Uint8Array([
    0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6,
]);

// H(spinCount) - the password/salt hash iterated spinCount times. This
// prefix is identical regardless of which of the three block-key
// purposes above it will be used for, so it's computed once and reused
// (see deriveBlockKey) rather than redone per purpose - a 3x reduction
// in the ~100,000-iteration hot loop.
function computeIteratedSpinHash(
    hashAlgorithm: string,
    saltValue: Uint8Array,
    password: string,
    spinCount: number
): Uint8Array {
    let current = hash(
        hashAlgorithm,
        saltValue,
        utf16leBytes(password)
    );

    for (
        let iteration = 0;
        iteration < spinCount;
        iteration += 1
    ) {
        current = hash(
            hashAlgorithm,
            uint32LE(iteration),
            current
        );
    }

    return current;
}

function deriveBlockKey(
    hashAlgorithm: string,
    spinHash: Uint8Array,
    blockKeyConstant: Uint8Array,
    keyBits: number
): Uint8Array {
    const finalHash = hash(
        hashAlgorithm,
        spinHash,
        blockKeyConstant
    );

    return fitToLength(finalHash, keyBits / 8);
}

async function importAesCbcKey(
    keyBytes: Uint8Array
): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "AES-CBC" },
        false,
        ["encrypt", "decrypt"]
    );
}

// Decrypts `ciphertext` (already a whole multiple of the block size,
// with NO PKCS7 padding applied to it) via AES-CBC. SubtleCrypto's
// AES-CBC decrypt always validates and strips PKCS7 padding from its
// output and offers no way to disable that - but MS-OFFCRYPTO's own
// encryption never applies it, so a literal SubtleCrypto decrypt call
// on this ciphertext would fail its own padding check on essentially
// every real file. Standard workaround: append one more ciphertext
// block, correctly chained (encrypt an empty buffer using the real
// "IV at that point" - the ciphertext's own last block, or `iv` if
// there is none), so it decrypts to exactly one block of valid 0x10
// padding - which SubtleCrypto then strips, leaving exactly the real,
// unpadded plaintext.
async function decryptAesCbcNoPadding(
    key: CryptoKey,
    iv: Uint8Array,
    ciphertext: Uint8Array
): Promise<Uint8Array> {
    if (ciphertext.length === 0) {
        return new Uint8Array(0);
    }

    const chainIv = ciphertext.slice(
        ciphertext.length - 16
    );

    const syntheticPadBlock = new Uint8Array(
        await crypto.subtle.encrypt(
            { name: "AES-CBC", iv: chainIv },
            key,
            new Uint8Array(0)
        )
    );

    const plaintext = await crypto.subtle.decrypt(
        { name: "AES-CBC", iv },
        key,
        concatBytes(ciphertext, syntheticPadBlock)
    );

    return new Uint8Array(plaintext);
}

function bytesEqual(
    a: Uint8Array,
    b: Uint8Array
): boolean {
    if (a.length !== b.length) {
        return false;
    }

    for (
        let index = 0;
        index < a.length;
        index += 1
    ) {
        if (a[index] !== b[index]) {
            return false;
        }
    }

    return true;
}

// --- /EncryptedPackage decryption ([MS-OFFCRYPTO] 2.3.4.15) ---

const PACKAGE_ENCRYPTION_CHUNK_SIZE = 4096;
// The stream's first 8 bytes hold the true (unpadded) package length -
// only the low 32 bits are read here, matching every other real-world
// implementation of this scheme (a package over 4GB is not a realistic
// concern for a bank statement).
const PACKAGE_LENGTH_PREFIX = 8;

async function decryptPackage(
    packageInfo: AgilePackageInfo,
    packageKey: Uint8Array,
    encryptedPackage: Uint8Array
): Promise<Uint8Array> {
    const key = await importAesCbcKey(packageKey);

    const declaredLength = new DataView(
        encryptedPackage.buffer,
        encryptedPackage.byteOffset,
        encryptedPackage.byteLength
    ).getUint32(0, true);

    const ciphertext = encryptedPackage.slice(
        PACKAGE_LENGTH_PREFIX
    );

    const chunks: Uint8Array[] = [];

    for (
        let chunkIndex = 0, start = 0;
        start < ciphertext.length;
        chunkIndex += 1,
            start += PACKAGE_ENCRYPTION_CHUNK_SIZE
    ) {
        const end = Math.min(
            start + PACKAGE_ENCRYPTION_CHUNK_SIZE,
            ciphertext.length
        );

        const iv = fitToLength(
            hash(
                packageInfo.hashAlgorithm,
                packageInfo.saltValue,
                uint32LE(chunkIndex)
            ),
            packageInfo.blockSize
        );

        const decryptedChunk =
            await decryptAesCbcNoPadding(
                key,
                iv,
                ciphertext.slice(start, end)
            );

        chunks.push(decryptedChunk);
    }

    return concatBytes(...chunks).slice(
        0,
        declaredLength
    );
}

// ZIP local-file-header signature ("PK\x03\x04") - every OOXML package
// (the decrypted result here) is a ZIP archive that must start with
// this, exactly as XLSX.read itself expects. A password that passes
// the verifier check (see decryptAgileWorkbook) but somehow still
// yields a non-ZIP result is treated the same as an incorrect
// password, matching upstream MS-OFFCRYPTO decrypt implementations'
// own extra safety check.
const ZIP_SIGNATURE = new Uint8Array([
    0x50, 0x4b, 0x03, 0x04,
]);

function looksLikeZip(bytes: Uint8Array): boolean {
    return (
        bytes.length >= 4 &&
        bytes[0] === ZIP_SIGNATURE[0] &&
        bytes[1] === ZIP_SIGNATURE[1] &&
        bytes[2] === ZIP_SIGNATURE[2] &&
        bytes[3] === ZIP_SIGNATURE[3]
    );
}

// --- CFB container access ---

function toUint8Array(
    content: number[] | Uint8Array
): Uint8Array {
    return content instanceof Uint8Array
        ? content
        : new Uint8Array(content);
}

function readCfb(
    content: ArrayBuffer
): ReturnType<typeof CFB.parse> | null {
    try {
        return CFB.parse(new Uint8Array(content));
    } catch {
        // Not a CFB container at all (a normal ZIP-based .xlsx, or any
        // other/corrupt file) - definitely not Agile-encrypted.
        return null;
    }
}

// Cheap, non-throwing check: does this look like an Agile-Encryption
// (VersionMinor 4) protected .xlsx? Used to decide whether to attempt
// real decryption before falling back to the existing xlsx.read-based
// detection/handling (unprotected files, legacy XOR .xls, RC4/Standard
// encryption - all unchanged, see excelParser.ts).
export function isAgileEncryptedWorkbook(
    content: ArrayBuffer
): boolean {
    const cfb = readCfb(content);

    if (!cfb) {
        return false;
    }

    const encryptionInfo = CFB.find(
        cfb,
        "/EncryptionInfo"
    );

    if (!encryptionInfo) {
        return false;
    }

    const header = readEncryptionInfoHeader(
        toUint8Array(encryptionInfo.content)
    );

    return header.versionMinor === 4;
}

// Decrypts an Agile-Encryption-protected .xlsx into the plain OOXML
// ZIP bytes XLSX.read already knows how to parse. Throws
// ExcelPasswordError("incorrect", ...) when the password fails the
// scheme's own verifier check (see [MS-OFFCRYPTO] 2.3.4.12) - never a
// generic/parse error, so the caller can offer a retry exactly as for
// the legacy XOR .xls path.
export async function decryptAgileWorkbook(
    content: ArrayBuffer,
    password: string
): Promise<ArrayBuffer> {
    const cfb = readCfb(content);

    const encryptionInfoEntry =
        cfb && CFB.find(cfb, "/EncryptionInfo");

    const encryptedPackageEntry =
        cfb && CFB.find(cfb, "/EncryptedPackage");

    if (!encryptionInfoEntry || !encryptedPackageEntry) {
        throw new ExcelPasswordError(
            "unsupported",
            UNSUPPORTED_PROTECTION_MESSAGE
        );
    }

    const encryptionInfoBytes = toUint8Array(
        encryptionInfoEntry.content
    );

    const xml = new TextDecoder("utf-8").decode(
        encryptionInfoBytes.slice(
            ENCRYPTION_INFO_HEADER_LENGTH
        )
    );

    const encryptionInfo =
        parseAgileEncryptionInfoXml(xml);

    // The full 100,000-iteration spin hash is computed exactly ONCE
    // and reused for all three password-derived keys below (see
    // computeIteratedSpinHash) - not redone per key.
    const spinHash = computeIteratedSpinHash(
        encryptionInfo.key.hashAlgorithm,
        encryptionInfo.key.saltValue,
        password,
        encryptionInfo.key.spinCount
    );

    const verifierHashInputKeyBytes = deriveBlockKey(
        encryptionInfo.key.hashAlgorithm,
        spinHash,
        BLOCK_KEY_VERIFIER_HASH_INPUT,
        encryptionInfo.key.keyBits
    );

    const verifierHashValueKeyBytes = deriveBlockKey(
        encryptionInfo.key.hashAlgorithm,
        spinHash,
        BLOCK_KEY_VERIFIER_HASH_VALUE,
        encryptionInfo.key.keyBits
    );

    const keyEncryptorKeyBytes = deriveBlockKey(
        encryptionInfo.key.hashAlgorithm,
        spinHash,
        BLOCK_KEY_KEY,
        encryptionInfo.key.keyBits
    );

    const verifierHashInputKey =
        await importAesCbcKey(
            verifierHashInputKeyBytes
        );

    const verifierHashValueKey =
        await importAesCbcKey(
            verifierHashValueKeyBytes
        );

    const keyEncryptorKey = await importAesCbcKey(
        keyEncryptorKeyBytes
    );

    // These three fields are all encrypted directly with
    // encryptionInfo.key.saltValue as the IV (no per-block IV
    // derivation - that only applies to the bulk package content
    // below).
    const verifierHashInput =
        await decryptAesCbcNoPadding(
            verifierHashInputKey,
            encryptionInfo.key.saltValue,
            encryptionInfo.key
                .encryptedVerifierHashInput
        );

    const verifierHashValue =
        await decryptAesCbcNoPadding(
            verifierHashValueKey,
            encryptionInfo.key.saltValue,
            encryptionInfo.key
                .encryptedVerifierHashValue
        );

    const expectedVerifierHashValue = padWithZeros(
        hash(
            encryptionInfo.key.hashAlgorithm,
            verifierHashInput
        ),
        verifierHashValue.length
    );

    if (
        !bytesEqual(
            expectedVerifierHashValue,
            verifierHashValue
        )
    ) {
        throw new ExcelPasswordError(
            "incorrect",
            "The password is incorrect."
        );
    }

    const packageKey = await decryptAesCbcNoPadding(
        keyEncryptorKey,
        encryptionInfo.key.saltValue,
        encryptionInfo.key.encryptedKeyValue
    );

    const decrypted = await decryptPackage(
        encryptionInfo.package,
        packageKey,
        toUint8Array(encryptedPackageEntry.content)
    );

    if (!looksLikeZip(decrypted)) {
        throw new ExcelPasswordError(
            "incorrect",
            "The password is incorrect."
        );
    }

    return decrypted.buffer.slice(
        decrypted.byteOffset,
        decrypted.byteOffset + decrypted.byteLength
    ) as ArrayBuffer;
}
