// Minimal ambient types for js-sha1/js-sha256/js-sha512 - none of these
// packages ship (or have a current) @types package, and only this tiny
// streaming subset (used by excelAgileDecryption.ts's iterative password
// hashing) is needed.
declare module "js-sha1" {
    interface Sha1Hasher {
        update(data: Uint8Array): Sha1Hasher;
        arrayBuffer(): ArrayBuffer;
    }

    export function create(): Sha1Hasher;
}

declare module "js-sha256" {
    interface Sha256Hasher {
        update(data: Uint8Array): Sha256Hasher;
        arrayBuffer(): ArrayBuffer;
    }

    export function create(): Sha256Hasher;
}

declare module "js-sha512" {
    interface Sha512Hasher {
        update(data: Uint8Array): Sha512Hasher;
        arrayBuffer(): ArrayBuffer;
    }

    export function create(): Sha512Hasher;

    export const sha384: {
        create(): Sha512Hasher;
    };
}
