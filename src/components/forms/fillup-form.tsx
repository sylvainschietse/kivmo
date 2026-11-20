"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Notice, Select, cx } from "@/components/ui";
import { IconCamera, IconLocate, IconMic, IconPlus } from "@/components/icons";
import { enqueueFillup, readQueue, sendFillup, writeQueue, type QueuedFillup } from "@/components/offline-queue";
import { PhotoButton, scanPhotos, type ScanState } from "@/components/photo-scan";

type Fuel = "E85" | "SP95" | "SP95_E10" | "SP98" | "GAZOLE" | "GPL" | "ELEC_KWH";
const FUEL_LABELS: Record<Fuel, string> = { E85: "E85", SP95: "SP95", SP95_E10: "SP95-E10", SP98: "SP98", GAZOLE: "Gazole", GPL: "GPL", ELEC_KWH: "Électricité (kWh)" };

interface Line {
  fuel: Fuel;
  liters: string;
  unitPrice: string;
  amount: string;
  discount: string;
  computed: "liters" | "unitPrice" | "amount" | null;
}

export interface StationOption {
  id: string;
  name: string | null;
  address: string;
  crowFliesKm: number | null;
  isDemo?: boolean;
  fuels: { fuel: Fuel; price: string | null; observedAt: string | null; stale: boolean; availability: string }[];
}

export interface FillupFormProps {
  vehicles: { id: string; name: string; energy: string; organizationId: string | null }[];
  defaultVehicleId: string;
  defaultFuel: Fuel;
  referenceNeedsPrice: Record<string, { fuel: Fuel; label: string } | null>;
  lastOdometer: Record<string, string | null>;
  initialStation?: StationOption | null;
  /** Lecture automatique des photos disponible (clé du service de vision configurée). */
  photoScan?: boolean;
}

interface FillupScanResult {
  odometerKm: string | null;
  liters: string | null;
  unitPrice: string | null;
  total: string | null;
  fuel: Fuel | null;
  date: string | null;
  stationName: string | null;
  confidence: "haute" | "moyenne" | "basse";
  note: string | null;
}

const num = (s: string) => {
  const t = s.replace(/[\s  ]/g, "").replace(",", ".");
  return t === "" || !/^\d+(\.\d+)?$/.test(t) ? null : Number(t);
};
const fr = (n: number, d: number) => n.toFixed(d).replace(".", ",");

function localNow() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** Recalcule la valeur manquante (deux sur trois) ; ne touche jamais une valeur saisie par l'utilisateur. */
function recompute(l: Line): Line {
  const L = l.computed === "liters" ? null : num(l.liters);
  const P = l.computed === "unitPrice" ? null : num(l.unitPrice);
  const T = l.computed === "amount" ? null : num(l.amount);
  const disc = num(l.discount) ?? 0;
  if (L !== null && P !== null && T === null) return { ...l, amount: fr(L * P - disc, 2), computed: "amount" };
  if (T !== null && P !== null && L === null && P > 0) return { ...l, liters: fr((T + disc) / P, 2), computed: "liters" };
  if (T !== null && L !== null && P === null && L > 0) return { ...l, unitPrice: fr((T + disc) / L, 3), computed: "unitPrice" };
  return l;
}

function ageLabel(iso: string | null) {
  if (!iso) return "date inconnue";
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  return h < 1 ? "il y a moins d'1 h" : h < 48 ? `il y a ${h} h` : `il y a ${Math.round(h / 24)} j`;
}

export function FillupForm(p: FillupFormProps) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [vehicleId, setVehicleId] = useState(p.defaultVehicleId);
  const [occurredAt, setOccurredAt] = useState("");
  const [odometer, setOdometer] = useState("");
  const [isFull, setIsFull] = useState(true);
  const [lines, setLines] = useState<Line[]>([{ fuel: p.defaultFuel, liters: "", unitPrice: "", amount: "", discount: "", computed: null }]);
  const [station, setStation] = useState<StationOption | null>(p.initialStation ?? null);
  const [stationLabel, setStationLabel] = useState(p.initialStation ? (p.initialStation.name ?? p.initialStation.address) : "");
  const [stations, setStations] = useState<StationOption[]>(p.initialStation ? [p.initialStation] : []);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [refPrice, setRefPrice] = useState("");
  const [missedBefore, setMissedBefore] = useState(false);
  const [newBaseline, setNewBaseline] = useState(false);
  const [usage, setUsage] = useState("personnel");
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ message: string }[] | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmNote, setConfirmNote] = useState("");
  const [mismatch, setMismatch] = useState<{ lineIndex: number; message: string; candidates: Record<string, string> } | null>(null);
  const [dictation, setDictation] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueuedFillup[]>([]);
  const submitting = useRef(false);
  const [scan, setScan] = useState<Record<"compteur" | "pompe", ScanState>>({ compteur: { status: "idle" }, pompe: { status: "idle" } });
  const [fromPhoto, setFromPhoto] = useState<Record<string, boolean>>({});
  const photoRing = (k: string) => (fromPhoto[k] ? "ring-2 ring-green" : "");

  useEffect(() => {
    // Valeurs propres au navigateur (identifiant, heure locale, file hors ligne) : posées après l'hydratation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setClientId(crypto.randomUUID());
    setOccurredAt(localNow());
    setQueue(readQueue());
  }, []);

  const vehicle = p.vehicles.find((v) => v.id === vehicleId);
  const refInfo = p.referenceNeedsPrice[vehicleId];
  const totals = useMemo(() => {
    const l = lines.reduce((a, x) => a + (num(x.liters) ?? 0), 0);
    const t = lines.reduce((a, x) => a + (num(x.amount) ?? 0), 0);
    return { liters: l, total: t };
  }, [lines]);

  function setLine(i: number, patch: Partial<Line>, field?: "liters" | "unitPrice" | "amount") {
    setLines((ls) =>
      ls.map((l, j) => {
        if (j !== i) return l;
        let next = { ...l, ...patch };
        // Une valeur modifiée par l'utilisateur n'est plus « calculée » ; on libère l'ancienne valeur calculée.
        if (field && next.computed === field) next.computed = null;
        if (field && next.computed && next.computed !== field) next = { ...next, [next.computed]: "", computed: null } as Line;
        return recompute(next);
      }),
    );
    setMismatch(null);
  }

  async function locate() {
    setGeoMsg(null);
    if (!("geolocation" in navigator)) return setGeoMsg("Géolocalisation indisponible sur cet appareil : recherchez par commune ou adresse.");
    setGeoMsg("Recherche de votre position…");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const acc = Math.round(pos.coords.accuracy);
        try {
          const res = await fetch(`/api/stations/nearby?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}&radiusKm=5`);
          if (!res.ok) throw new Error();
          const list = (await res.json()) as StationOption[];
          setStations(list);
          setGeoMsg(`Position à ±${acc} m${acc > 500 ? " (imprécise : vérifiez la station proposée)" : ""}. ${list.length ? `${list.length} station(s) dans 5 km (distance à vol d'oiseau).` : "Aucune station référencée à proximité : saisissez son nom."}`);
        } catch {
          setGeoMsg("Réseau indisponible : saisissez le nom de la station, le prix sera celui du ticket.");
        }
      },
      (err) => setGeoMsg(err.code === err.PERMISSION_DENIED ? "Localisation refusée : vous pouvez rechercher par commune ou adresse." : "Position introuvable : recherchez par commune ou adresse."),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  async function searchStations() {
    if (search.trim().length < 2) return;
    try {
      const res = await fetch(`/api/stations/search?q=${encodeURIComponent(search)}`);
      const list = (await res.json()) as StationOption[];
      setStations(list);
      setGeoMsg(list.length ? `${list.length} résultat(s).` : "Aucune station trouvée : saisissez son nom, elle sera enregistrée comme non référencée.");
    } catch {
      setGeoMsg("Recherche impossible hors ligne.");
    }
  }

  function chooseStation(s: StationOption) {
    setStation(s);
    setStationLabel(s.name ?? s.address);
    const f = s.fuels.find((x) => x.fuel === lines[0].fuel);
    if (f?.price && !lines[0].unitPrice) setLine(0, { unitPrice: f.price.replace(".", ",") }, "unitPrice");
  }

  async function upload(file: File) {
    setUploadMsg("Envoi du ticket…");
    const fd = new FormData();
    fd.set("file", file);
    fd.set("kind", "ticket");
    if (vehicle?.organizationId) fd.set("organizationId", vehicle.organizationId);
    try {
      const res = await fetch("/api/attachments", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) return setUploadMsg(body?.error?.message ?? "Envoi impossible.");
      if (body.usedByFillupId) return setUploadMsg("Ce ticket est déjà associé à un plein : il ne sera pas utilisé deux fois.");
      setReceiptId(body.id);
      setUploadMsg(body.ocr?.status === "a_connecter" ? `Ticket enregistré en privé. ${body.ocr.message}` : "Ticket enregistré. Vérifiez chaque champ proposé avant d'enregistrer.");
    } catch {
      setUploadMsg("Hors ligne : le ticket pourra être ajouté plus tard depuis la fiche du plein.");
    }
  }

  /** Photo du compteur ou de la pompe : les valeurs lues pré-remplissent le formulaire, à vérifier. */
  async function readPhoto(kind: "compteur" | "pompe", file: File) {
    setScan((s) => ({ ...s, [kind]: { status: "reading" } }));
    const r = await scanPhotos<FillupScanResult>("fillup", { [kind === "pompe" ? "pompe" : "compteur"]: file });
    if (!r.ok) return setScan((s) => ({ ...s, [kind]: { status: "error", message: r.message } }));
    const x = r.result;
    const filled: string[] = [];
    const marks: Record<string, boolean> = {};
    const digits = x.odometerKm?.replace(/\D/g, "") ?? "";
    if (digits) {
      setOdometer(digits);
      marks.odometer = true;
      filled.push(`compteur ${Number(digits).toLocaleString("fr-FR")} km`);
    }
    const dec = (v: string | null) => (v && num(v) !== null ? v.replace(".", ",") : "");
    const L = dec(x.liters), P = dec(x.unitPrice), T = dec(x.total);
    if (L || P || T || x.fuel) {
      setLines((ls) => ls.map((l, j) => {
        if (j !== 0) return l;
        const next: Line = { ...l, fuel: x.fuel ?? l.fuel, liters: L || (l.computed === "liters" ? "" : l.liters), unitPrice: P || (l.computed === "unitPrice" ? "" : l.unitPrice), amount: T || (l.computed === "amount" ? "" : l.amount), computed: null };
        return recompute(next);
      }));
      setMismatch(null);
      if (x.fuel) { marks.fuel = true; filled.push(FUEL_LABELS[x.fuel]); }
      if (L) { marks.liters = true; filled.push(`${L} L`); }
      if (P) { marks.unitPrice = true; filled.push(`${P} €/L`); }
      if (T) { marks.amount = true; filled.push(`${T} €`); }
    }
    if (x.date && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(x.date) && x.date <= localNow()) { setOccurredAt(x.date); marks.occurredAt = true; }
    if (x.stationName && !stationLabel) { setStationLabel(x.stationName); marks.station = true; }
    setFromPhoto((m) => ({ ...m, ...marks }));
    const doubt = x.confidence !== "haute" ? " Lecture incertaine : vérifiez bien." : "";
    setScan((s) => ({
      ...s,
      [kind]: filled.length
        ? { status: "done", message: `Lu : ${filled.join(" · ")}.${doubt}${x.note ? ` ${x.note}` : ""}` }
        : { status: "error", message: x.note ?? "Rien de lisible sur cette photo. Reprenez-la de plus près, ou saisissez à la main." },
    }));
  }

  function dictate() {
    type SR = { lang: string; interimResults: boolean; start(): void; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onerror: () => void };
    const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) return setDictation("Dictée non prise en charge par ce navigateur.");
    const r = new Ctor();
    r.lang = "fr-FR";
    r.interimResults = false;
    setDictation("Parlez : par exemple « 45 litres, 40 euros 50, compteur 10 600 ».");
    r.onresult = (e) => {
      const text = e.results[0][0].transcript.toLowerCase();
      const litres = text.match(/(\d+(?:[.,]\d+)?)\s*(?:litres?|l\b)/);
      const euros = text.match(/(\d+)\s*(?:euros?|€)\s*(\d{1,2})?/);
      const compteur = text.match(/compteur\s*(\d[\d\s]*)/);
      const patch: Partial<Line> = {};
      if (litres) patch.liters = litres[1].replace(".", ",");
      if (euros) patch.amount = euros[2] ? `${euros[1]},${euros[2].padEnd(2, "0")}` : euros[1];
      setLine(0, patch, patch.amount ? "amount" : "liters");
      if (compteur) setOdometer(compteur[1].replace(/\s/g, ""));
      setDictation(`Compris : « ${text} ». Vérifiez les champs remplis avant d'enregistrer.`);
    };
    r.onerror = () => setDictation("Dictée interrompue.");
    r.start();
  }

  function payload() {
    return {
      vehicleId,
      occurredAt: new Date(occurredAt).toISOString(),
      odometerKm: odometer,
      isFull,
      lines: lines.map((l) => ({ fuel: l.fuel, liters: l.liters || null, unitPrice: l.unitPrice || null, amount: l.amount || null, discount: l.discount || null })),
      stationId: station?.id ?? null,
      stationLabel: stationLabel || null,
      referencePrice: refPrice || null,
      missedBefore,
      startsNewBaseline: newBaseline,
      usage,
      receiptAttachmentId: receiptId,
      confirmIssues: confirmed,
      confirmDuplicate: confirmed,
      confirmNote: confirmNote || null,
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current) return; // double clic
    submitting.current = true;
    setBusy(true);
    setError(null);
    const body = payload();
    try {
      if (!navigator.onLine) throw new TypeError("offline");
      const r = await sendFillup(body, clientId);
      if (r.ok && (r.body.status === "created" || r.body.status === "existing")) {
        router.push(`/pleins/${r.body.fillup.id}?nouveau=1`);
        return;
      }
      if (r.body.status === "needs_confirmation") setIssues(r.body.issues);
      else if (r.body.status === "amount_mismatch") setMismatch(r.body);
      else if (r.status === 401) setError("Votre session a expiré. Reconnectez-vous : votre saisie reste dans ce formulaire.");
      else setError(r.body?.error?.message ?? "Enregistrement impossible.");
    } catch {
      enqueueFillup(body, clientId);
      setQueue(readQueue());
      setError(null);
      setIssues(null);
      setClientId(crypto.randomUUID());
      alertOffline();
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const [offlineSaved, setOfflineSaved] = useState(false);
  function alertOffline() {
    setOfflineSaved(true);
  }

  function applyCandidate(field: "liters" | "unitPrice" | "total") {
    if (!mismatch) return;
    const i = mismatch.lineIndex;
    const v = mismatch.candidates[field].replace(".", ",");
    const key = field === "total" ? "amount" : field;
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [key]: v, computed: null } : l)));
    setMismatch(null);
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {offlineSaved && (
        <Notice tone="info" title="Enregistré sur cet appareil">
          Pas de réseau : le plein est placé dans la file locale avec un identifiant stable. Il sera envoyé quand vous choisirez « Synchroniser maintenant », sans risque de doublon.
        </Notice>
      )}
      {queue.length > 0 && (
        <Card title={`File hors ligne (${queue.length})`}>
          <ul className="space-y-2 text-sm">
            {queue.map((q) => (
              <li key={q.clientId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 p-2">
                <span>
                  {new Date(String(q.payload.occurredAt)).toLocaleString("fr-FR")} · compteur {String(q.payload.odometerKm)} km
                  {q.message && <span className="block text-warn">{q.message}</span>}
                </span>
                <span className="flex gap-2">
                  <button type="button" className="tap rounded-lg px-2 text-sm underline" onClick={() => {
                    const pl = q.payload as ReturnType<typeof payload>;
                    setVehicleId(pl.vehicleId); setOdometer(String(pl.odometerKm)); setIsFull(pl.isFull);
                    setLines(pl.lines.map((l) => ({ fuel: l.fuel as Fuel, liters: l.liters ?? "", unitPrice: l.unitPrice ?? "", amount: l.amount ?? "", discount: l.discount ?? "", computed: null })));
                    setClientId(q.clientId);
                  }}>Reprendre</button>
                  <button type="button" className="tap rounded-lg px-2 text-sm text-loss underline" onClick={() => { const n = readQueue().filter((x) => x.clientId !== q.clientId); writeQueue(n); setQueue(n); }}>Supprimer</button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {p.photoScan && (
        <Card title="Remplir avec des photos" action={<span className="text-xs text-muted">À vérifier ensuite</span>}>
          <div className="grid gap-2 sm:grid-cols-2">
            <PhotoButton label="Photo du compteur" hint="Le kilométrage se remplit tout seul." state={scan.compteur} onPhoto={(f) => readPhoto("compteur", f)} />
            <PhotoButton label="Photo de la pompe" hint="Litres, prix au litre, montant et carburant. Un ticket marche aussi." state={scan.pompe} onPhoto={(f) => readPhoto("pompe", f)} />
          </div>
        </Card>
      )}

      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Véhicule" htmlFor="vehicleId">
            <Select id="vehicleId" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              {p.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
          </Field>
          <Field label="Date et heure" htmlFor="occurredAt">
            <Input id="occurredAt" type="datetime-local" className={photoRing("occurredAt")} value={occurredAt} max={localNow()} onChange={(e) => setOccurredAt(e.target.value)} required />
          </Field>
          <Field label="Compteur (km)" htmlFor="odometer" hint={p.lastOdometer[vehicleId] ? `Dernier relevé : ${p.lastOdometer[vehicleId]} km` : undefined}>
            <Input id="odometer" inputMode="numeric" autoComplete="off" className={photoRing("odometer")} value={odometer} onChange={(e) => setOdometer(e.target.value)} required />
          </Field>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium">Type de plein</legend>
            <div className="grid grid-cols-2 gap-2">
              {[[true, "Complet"], [false, "Partiel"]].map(([v, l]) => (
                <label key={String(v)} className={cx("tap flex cursor-pointer items-center justify-center rounded-xl border px-3 text-sm font-semibold", isFull === v ? "border-green bg-green-soft text-green" : "border-line")}>
                  <input type="radio" name="isFull" className="sr-only" checked={isFull === v} onChange={() => setIsFull(v as boolean)} />
                  {l as string}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </Card>

      <Card title="Carburant et montants" action={<span className="text-xs text-muted">Deux valeurs suffisent</span>}>
        <div className="space-y-4">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Field label={lines.length > 1 ? `Carburant ${i + 1}` : "Carburant"} htmlFor={`fuel-${i}`}>
                <Select id={`fuel-${i}`} className={i === 0 ? photoRing("fuel") : ""} value={l.fuel} onChange={(e) => setLine(i, { fuel: e.target.value as Fuel })}>
                  {(Object.keys(FUEL_LABELS) as Fuel[]).map((f) => <option key={f} value={f}>{FUEL_LABELS[f]}</option>)}
                </Select>
              </Field>
              <Field label={l.fuel === "ELEC_KWH" ? "kWh" : "Litres"} htmlFor={`liters-${i}`} hint={l.computed === "liters" ? "calculé" : undefined}>
                <Input id={`liters-${i}`} inputMode="decimal" value={l.liters} onChange={(e) => setLine(i, { liters: e.target.value }, "liters")} className={cx(l.computed === "liters" && "bg-surface-2", i === 0 && photoRing("liters"))} />
              </Field>
              <Field label="Prix affiché (€/L)" htmlFor={`price-${i}`} hint={l.computed === "unitPrice" ? "calculé" : undefined}>
                <Input id={`price-${i}`} inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value }, "unitPrice")} className={cx(l.computed === "unitPrice" && "bg-surface-2", i === 0 && photoRing("unitPrice"))} />
              </Field>
              <Field label="Total payé (€)" htmlFor={`amount-${i}`} hint={l.computed === "amount" ? "calculé — le ticket fait foi" : "le ticket fait foi"}>
                <Input id={`amount-${i}`} inputMode="decimal" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value }, "amount")} className={cx(l.computed === "amount" && "bg-surface-2", i === 0 && photoRing("amount"))} />
              </Field>
              <Field label="Remise (€)" htmlFor={`discount-${i}`}>
                <Input id={`discount-${i}`} inputMode="decimal" value={l.discount} onChange={(e) => setLine(i, { discount: e.target.value })} />
              </Field>
              {lines.length > 1 && (
                <button type="button" className="tap col-span-2 justify-self-start text-sm text-loss underline sm:col-span-5" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>Retirer cette ligne</button>
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" className="tap inline-flex items-center gap-1 text-sm font-semibold text-green" onClick={() => setLines((ls) => [...ls, { fuel: "SP95_E10", liters: "", unitPrice: "", amount: "", discount: "", computed: null }])}>
              <IconPlus width={18} /> Ajouter un carburant (mélange)
            </button>
            <p className="num text-sm font-semibold">Total : {fr(totals.total, 2)} € · {fr(totals.liters, 2)} L</p>
          </div>
          {lines.length > 1 && <p className="text-xs text-muted">Le mélange est mesuré tel que déclaré : aucun taux d&apos;éthanol réel n&apos;est déduit du libellé E85.</p>}
          {mismatch && (
            <Notice tone="warn" title="Valeurs incohérentes">
              {mismatch.message}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => applyCandidate("total")}>Total → {mismatch.candidates.total.replace(".", ",")} €</Button>
                <Button type="button" variant="secondary" onClick={() => applyCandidate("liters")}>Litres → {Number(mismatch.candidates.liters).toFixed(2).replace(".", ",")}</Button>
                <Button type="button" variant="secondary" onClick={() => applyCandidate("unitPrice")}>Prix → {Number(mismatch.candidates.unitPrice).toFixed(3).replace(".", ",")}</Button>
              </div>
            </Notice>
          )}
        </div>
      </Card>

      <Card title="Station">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={locate}><IconLocate width={18} /> Stations proches</Button>
            <div className="flex min-w-0 flex-1 gap-2">
              <label htmlFor="station-search" className="sr-only">Rechercher par commune ou adresse</label>
              <Input id="station-search" placeholder="Commune, code postal ou adresse" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); searchStations(); } }} />
              <Button type="button" variant="secondary" onClick={searchStations}>Chercher</Button>
            </div>
          </div>
          {geoMsg && <p className="text-sm text-muted" role="status">{geoMsg}</p>}
          {stations.length > 0 && (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {stations.map((s) => {
                const f = s.fuels.find((x) => x.fuel === lines[0].fuel);
                return (
                  <li key={s.id}>
                    <button type="button" onClick={() => chooseStation(s)} className={cx("tap w-full rounded-xl border p-2 text-left text-sm", station?.id === s.id ? "border-green bg-green-soft" : "border-line")}>
                      <span className="font-semibold">{s.name ?? s.address}</span>{s.isDemo && " (démo)"}
                      <span className="block text-muted">
                        {s.address}{s.crowFliesKm !== null ? ` · ${fr(s.crowFliesKm, 1)} km à vol d'oiseau` : ""}
                        {f?.price ? ` · ${f.price.replace(".", ",")} €/L ${ageLabel(f.observedAt)}${f.stale ? " (ancien)" : ""}` : " · prix inconnu"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <Field label="Nom de la station" htmlFor="stationLabel" hint={station ? "Station sélectionnée : le prix proposé est daté et modifiable, le ticket fait foi." : "Station non référencée : saisissez son nom."}>
            <Input id="stationLabel" className={photoRing("station")} value={stationLabel} onChange={(e) => { setStationLabel(e.target.value); if (station && e.target.value !== (station.name ?? station.address)) setStation(null); }} />
          </Field>
          {refInfo && (
            <Field label={`Prix de référence ${refInfo.label} (€/L, facultatif)`} htmlFor="refPrice" hint="Sans prix daté disponible, la comparaison de cet intervalle sera « incomplète » (jamais zéro).">
              <Input id="refPrice" inputMode="decimal" value={refPrice} onChange={(e) => setRefPrice(e.target.value)} />
            </Field>
          )}
        </div>
      </Card>

      <Card title="Ticket et options">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <label className="tap inline-flex cursor-pointer items-center gap-2 rounded-xl bg-surface-2 px-4 py-2 text-sm font-semibold">
              <IconCamera width={18} /> Photo du ticket
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </label>
            <Button type="button" variant="secondary" onClick={dictate}><IconMic width={18} /> Dicter</Button>
          </div>
          {uploadMsg && <p className="text-sm text-muted" role="status">{uploadMsg}</p>}
          {dictation && <p className="text-sm text-muted" role="status">{dictation}</p>}
          <Field label="Usage" htmlFor="usage">
            <Select id="usage" value={usage} onChange={(e) => setUsage(e.target.value)}>
              <option value="personnel">Personnel</option>
              <option value="professionnel">Professionnel</option>
              <option value="mixte">Mixte</option>
            </Select>
          </Field>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-5 w-5" checked={missedBefore} onChange={(e) => setMissedBefore(e.target.checked)} /> J&apos;ai oublié de saisir un achat avant celui-ci (l&apos;intervalle sera marqué suspect)</label>
          {isFull && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-5 w-5" checked={newBaseline} onChange={(e) => setNewBaseline(e.target.checked)} /> Repartir de ce plein comme nouveau repère complet</label>}
        </div>
      </Card>

      {issues && (
        <Notice tone="warn" title="À confirmer avant enregistrement">
          <ul className="list-disc pl-5">{issues.map((i, k) => <li key={k}>{i.message}</li>)}</ul>
          <label className="mt-2 flex items-start gap-2"><input type="checkbox" className="mt-1 h-5 w-5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Je confirme ces valeurs</label>
          <Field label="Explication (facultatif)" htmlFor="confirmNote"><Input id="confirmNote" value={confirmNote} onChange={(e) => setConfirmNote(e.target.value)} /></Field>
        </Notice>
      )}
      {error && <Notice tone="loss">{error}</Notice>}
      <div className="sticky bottom-20 z-10 lg:bottom-4">
        <Button type="submit" disabled={busy || (issues !== null && !confirmed)} className="w-full py-3 text-base shadow-lg">
          {busy ? "Enregistrement…" : issues ? "Confirmer et enregistrer" : "Enregistrer le plein"}
        </Button>
      </div>
    </form>
  );
}
