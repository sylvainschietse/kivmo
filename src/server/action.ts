import "server-only";
import { redirect } from "next/navigation";
import { AppError } from "./errors";

/** Exécute une action serveur ; en cas d'erreur métier, renvoie vers la page avec le message. */
export async function runAction(back: string, fn: () => Promise<string | void>) {
  let target: string | void;
  try {
    target = await fn();
  } catch (e) {
    if (e instanceof AppError) {
      const sep = back.includes("?") ? "&" : "?";
      redirect(`${back}${sep}erreur=${encodeURIComponent(e.message)}`);
    }
    throw e;
  }
  if (target) redirect(target);
}

export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
export const optStr = (fd: FormData, k: string) => str(fd, k) || null;
