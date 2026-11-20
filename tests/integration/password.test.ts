import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, expectCode } from "./helpers";
import { schema } from "@/db/client";
import { changePassword, hashPassword, loginWithPassword, resolveSession, signUpWithPassword, verifyPassword } from "@/server/auth";
import { createDemoAccount } from "@/server/services/demo";

const mail = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
const PW = "un-mot-de-passe-solide";

describe("Compte par mot de passe", () => {
  it("empreinte salée : jamais le mot de passe en clair, deux empreintes différentes", async () => {
    const a = await hashPassword(PW);
    const b = await hashPassword(PW);
    expect(a).not.toContain(PW);
    expect(a).not.toBe(b);
    expect(await verifyPassword(PW, a)).toBe(true);
    expect(await verifyPassword("autre-mot-de-passe", a)).toBe(false);
    expect(await verifyPassword(PW, null)).toBe(false);
  });

  it("inscription, session valide, connexion, refus d'un doublon (casse ignorée)", async () => {
    const email = mail("Inscrit");
    const { user, sessionToken } = await signUpWithPassword(db(), email, PW);
    expect(user.email).toBe(email.toLowerCase());
    expect((await resolveSession(db(), sessionToken))?.ctx.userId).toBe(user.id);
    const [profile] = await db().select().from(schema.profiles).where(eq(schema.profiles.userId, user.id));
    expect(profile).toBeTruthy();
    const login = await loginWithPassword(db(), email.toUpperCase(), PW);
    expect(login.user.id).toBe(user.id);
    await expectCode(signUpWithPassword(db(), email.toUpperCase(), PW), "CONFLICT");
  });

  it("mauvais mot de passe et adresse inconnue : même message", async () => {
    const email = mail("erreur");
    await signUpWithPassword(db(), email, PW);
    const msgs: string[] = [];
    for (const [e, p] of [[email, "mauvais-mot-de-passe"], [mail("inconnu"), PW]]) {
      try {
        await loginWithPassword(db(), e, p);
      } catch (err) {
        msgs.push((err as Error).message);
      }
    }
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toBe(msgs[1]);
  });

  it("mot de passe trop court refusé ; changement exige l'ancien", async () => {
    await expectCode(signUpWithPassword(db(), mail("court"), "court"), "VALIDATION");
    const { user } = await signUpWithPassword(db(), mail("change"), PW);
    await expectCode(changePassword(db(), user.id, "faux-mot-de-passe", "nouveau-mot-de-passe"), "VALIDATION");
    await changePassword(db(), user.id, PW, "nouveau-mot-de-passe");
    await expectCode(loginWithPassword(db(), user.email, PW), "VALIDATION");
    expect((await loginWithPassword(db(), user.email, "nouveau-mot-de-passe")).user.id).toBe(user.id);
  });

  it("un compte de démonstration ne peut ni se connecter par mot de passe ni en définir un", async () => {
    const ctx = await createDemoAccount(db());
    await expectCode(changePassword(db(), ctx.userId, "", "nouveau-mot-de-passe"), "FORBIDDEN");
  });
});
