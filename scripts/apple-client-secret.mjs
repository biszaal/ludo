#!/usr/bin/env node
/**
 * Generate the Apple "client secret" for Supabase's Apple auth provider.
 *
 * Apple does not issue a client secret. It issues a signing KEY, and the secret
 * is a short-lived JWT you sign with it yourself. Supabase's dashboard asks for
 * the finished JWT, so this is the missing step between downloading the .p8 and
 * filling in that field.
 *
 * THIS EXPIRES. Apple caps the lifetime at six months, and when it lapses Sign
 * in with Apple stops working — which for Ludo means account RECOVERY stops
 * working, silently, for anyone who linked with Apple. Re-run this and paste the
 * new value into the dashboard before then. The expiry it used is printed below
 * so it can go straight into a calendar.
 *
 * Deliberately dependency-free: it runs from a clean checkout six months from
 * now without an install step, which is the whole point of a rotation script.
 * Node signs ES256 natively — `ieee-p1363` is the raw r||s encoding JWT wants,
 * as opposed to Node's default DER, which Apple would reject.
 *
 * The private key is read from disk and never printed. Keep the .p8 out of git
 * (it is not in this repo, and must not be added).
 *
 * Usage:
 *   node scripts/apple-client-secret.mjs \
 *     --key ~/secure/AuthKey_ABC123XYZ.p8 \
 *     --team HG4G2ZMGV8 \
 *     --kid ABC123XYZ \
 *     --services com.biszaal.mobile.web
 */

import { sign as cryptoSign } from "node:crypto";
import { readFileSync } from "node:fs";

/** Apple's ceiling on a client secret's lifetime: six months, in seconds. */
const MAX_LIFETIME_S = 15777000;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

const keyPath = arg("key");
const teamId = arg("team");
const keyId = arg("kid");
const servicesId = arg("services");

if (!keyPath || !teamId || !keyId || !servicesId) {
  console.error(
    "Usage: node scripts/apple-client-secret.mjs --key <AuthKey_XXX.p8> --team <TeamID> --kid <KeyID> --services <ServicesID>",
  );
  process.exit(1);
}

let privateKey;
try {
  privateKey = readFileSync(keyPath, "utf8");
} catch (e) {
  console.error(`Could not read the signing key at ${keyPath}: ${e.message}`);
  process.exit(1);
}
if (!privateKey.includes("BEGIN PRIVATE KEY")) {
  console.error("That file does not look like an Apple .p8 signing key.");
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const exp = now + MAX_LIFETIME_S;

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const signingInput = [
  b64url({ alg: "ES256", kid: keyId, typ: "JWT" }),
  // `sub` is the Services ID, and it is the claim Supabase's "Client IDs" field
  // is checked against. A bundle ID here is the commonest way to get an
  // "invalid_client" that looks like a key problem and is not.
  b64url({ iss: teamId, iat: now, exp, aud: "https://appleid.apple.com", sub: servicesId }),
].join(".");

let signature;
try {
  // ieee-p1363 = raw r||s. Node's default is DER, which Apple rejects.
  signature = cryptoSign("sha256", Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
} catch (e) {
  console.error(`Could not sign with that key: ${e.message}`);
  process.exit(1);
}

console.log(`${signingInput}.${signature}`);
console.error(""); // stderr, so `> secret.txt` captures only the token
console.error(`Expires: ${new Date(exp * 1000).toISOString().slice(0, 10)} — set a reminder BEFORE then.`);
console.error("Paste the token above into Supabase → Auth → Providers → Apple → Secret Key (for OAuth).");
