import { api } from "@/server/api";
import { exportAccount } from "@/server/services/exports";

export const GET = api(async ({ db, ctx }) => {
  const data = await exportAccount(db, ctx);
  return new Response(JSON.stringify(data, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="kivmo-mes-donnees.json"` } });
});
