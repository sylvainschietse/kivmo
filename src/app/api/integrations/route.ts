import { integrations } from "@/integrations/registry";
import { json } from "@/server/api";

export async function GET() {
  return json(integrations().map(({ key, label, status, fallback }) => ({ key, label, status, fallback })));
}
