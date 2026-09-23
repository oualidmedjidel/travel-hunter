/**
 * Web Push — l'alerte qui manquait à la veille, sans une seule dépendance.
 *
 * Deux décisions portent tout le fichier :
 *
 * 1. **La paire VAPID est générée par le serveur**, au premier besoin, et rangée dans le
 *    même fichier que les veilles — hors du dépôt. Personne ne colle de secret, aucune
 *    clé privée ne transite par un terminal, une conversation ou un `.env`. La clé
 *    publique, elle, est faite pour être publiée : la page en a besoin pour s'abonner.
 *
 * 2. **On n'envoie aucune charge utile.** Le chiffrement d'un message poussé (RFC 8291 :
 *    ECDH, HKDF, aes128gcm) n'est obligatoire que si l'on transporte du contenu. Un
 *    réveil vide ne demande que la signature VAPID — quelques lignes au lieu de deux
 *    cents, et surtout : **rien de ce que surveille l'utilisateur ne traverse les
 *    serveurs de Google, Apple ou Mozilla.** Le service worker, réveillé, demande au
 *    site lui-même quoi afficher.
 *
 * ponytail: plafond — sans charge utile, une notification coûte un aller-retour de plus
 * au navigateur. À l'échelle d'une poignée d'alertes par jour, c'est invisible ; si le
 * volume changeait, il faudrait chiffrer et envoyer le texte directement.
 */
import { createSign, generateKeyPairSync, createPublicKey, createPrivateKey } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Clé publique au format « point non compressé » (0x04 ‖ x ‖ y), celui qu'attend le navigateur. */
export function pointPublic(jwk) {
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  return b64url(Buffer.concat([Buffer.from([4]), x, y]));
}

/** Génère une paire VAPID. Rendue en JWK : sérialisable tel quel dans le fichier JSON. */
export function genererVapid() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pub = publicKey.export({ format: "jwk" });
  const priv = privateKey.export({ format: "jwk" });
  return { publique: pub, privee: priv, point: pointPublic(pub) };
}

/**
 * Jeton VAPID pour un point d'entrée donné. `aud` est l'ORIGINE du service de push, pas
 * l'URL complète : un jeton signé pour `https://fcm.googleapis.com` vaut pour tous ses
 * points d'entrée, et c'est ce que la spécification impose.
 */
export function jetonVapid(vapid, endpoint, { sujet = process.env.VAPID_SUJET || "https://travel-hunter.fr",
                                              maintenant = Date.now(), dureeH = 12 } = {}) {
  const aud = new URL(endpoint).origin;
  const entete = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const corps = b64url(JSON.stringify({
    aud, sub: sujet,
    exp: Math.floor(maintenant / 1000) + dureeH * 3600
  }));
  const aSigner = `${entete}.${corps}`;

  const cle = createPrivateKey({ key: vapid.privee, format: "jwk" });
  // `ieee-p1363` rend la signature brute r‖s de 64 octets ; le DER par défaut serait
  // refusé par tous les services de push.
  const signature = createSign("SHA256").update(aSigner).end()
    .sign({ key: cle, dsaEncoding: "ieee-p1363" });
  return `${aSigner}.${b64url(signature)}`;
}

/**
 * Réveille un abonnement. Ne lève jamais : une alerte perdue ne doit pas arrêter la
 * boucle de relevé.
 *
 * Rend `{ ok, statut, perime }`. `perime` vaut true sur 404 et 410 : le navigateur a
 * désinstallé l'abonnement, il faut l'oublier de notre côté aussi — sinon le fichier
 * se remplit d'adresses mortes qu'on réessaie indéfiniment.
 */
export async function reveiller(vapid, abonnement, { fetchImpl = fetch, ttl = 86400 } = {}) {
  try {
    const r = await fetchImpl(abonnement.endpoint, {
      method: "POST",
      headers: {
        TTL: String(ttl),
        "content-length": "0",
        urgency: "normal",
        authorization: `vapid t=${jetonVapid(vapid, abonnement.endpoint)}, k=${vapid.point}`
      },
      redirect: "manual"     // même règle que les proxys : on ne suit jamais un 3xx
    });
    return { ok: r.status >= 200 && r.status < 300, statut: r.status, perime: r.status === 404 || r.status === 410 };
  } catch (e) {
    return { ok: false, statut: e.name, perime: false };
  }
}

/** Forme minimale d'un abonnement : une URL https, et c'est tout ce dont on se sert. */
export function abonnementValide(a) {
  if (!a || typeof a !== "object" || typeof a.endpoint !== "string") return null;
  let u;
  try { u = new URL(a.endpoint); } catch { return null; }
  if (u.protocol !== "https:") return null;
  if (a.endpoint.length > 1000) return null;
  // Les clés `p256dh` et `auth` ne servent qu'au chiffrement d'une charge utile ; on
  // n'en envoie pas. On les garde quand même : le jour où l'on chiffrera, elles seront là.
  return {
    endpoint: a.endpoint,
    p256dh: typeof a.keys?.p256dh === "string" ? a.keys.p256dh.slice(0, 200) : null,
    auth: typeof a.keys?.auth === "string" ? a.keys.auth.slice(0, 100) : null,
    creee: new Date().toISOString()
  };
}
