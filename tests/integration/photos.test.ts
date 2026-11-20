import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, makeUser, expectCode } from "./helpers";
import { schema } from "@/db/client";
import { createVehicle, setVehiclePhoto } from "@/server/services/vehicles";
import { readAttachment, storeAttachment } from "@/server/services/attachments";

const jpeg = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 32 }, () => Math.floor(Math.random() * 255))]);

describe("Photos : stockage durable en base et vignette du véhicule", () => {
  afterEach(() => {
    delete process.env.STORAGE_BACKEND;
  });

  it("en mode base, le fichier est conservé dans PostgreSQL et relu à l'identique", async () => {
    process.env.STORAGE_BACKEND = "db";
    const u = await makeUser("photo-db");
    const data = jpeg();
    const { attachment } = await storeAttachment(db(), u, { kind: "ticket", mimeType: "image/jpeg", data });
    expect(attachment.storageKey.startsWith("db:")).toBe(true);
    const back = await readAttachment(db(), u, attachment.id);
    expect(Buffer.compare(back.data, data)).toBe(0);
  });

  it("la photo du véhicule devient sa vignette, invisible pour un autre compte", async () => {
    process.env.STORAGE_BACKEND = "db";
    const u = await makeUser("photo-v");
    const other = await makeUser("photo-x");
    const v = await createVehicle(db(), u, { name: "Clio", energy: "essence" });
    const id = await setVehiclePhoto(db(), u, v.id, `data:image/jpeg;base64,${jpeg().toString("base64")}`);
    const [row] = await db().select().from(schema.vehicles).where(eq(schema.vehicles.id, v.id));
    expect(row.photoAttachmentId).toBe(id);
    await expect(readAttachment(db(), other, id)).rejects.toThrow();
    await expect(setVehiclePhoto(db(), other, v.id, `data:image/jpeg;base64,${jpeg().toString("base64")}`)).rejects.toThrow();
  });

  it("refuse une photo qui n'est pas une image", async () => {
    const u = await makeUser("photo-bad");
    const v = await createVehicle(db(), u, { name: "Zoé", energy: "electrique" });
    await expectCode(setVehiclePhoto(db(), u, v.id, "data:text/html;base64,PGh0bWw+"), "VALIDATION");
  });
});
