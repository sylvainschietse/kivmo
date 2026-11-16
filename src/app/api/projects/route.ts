import { api } from "@/server/api";
import { createProject, projectFigures } from "@/server/services/savings";

export const GET = api(async ({ db, ctx }) =>
  (await projectFigures(db, ctx)).map((p) => ({ ...p.project, figures: Object.fromEntries(Object.entries(p.figures).map(([k, v]) => [k, v.toString()])), transferable: p.transferable.toString() })),
);
export const POST = api(async ({ req, db, ctx }) => Response.json(await createProject(db, ctx, await req.json()), { status: 201 }));
