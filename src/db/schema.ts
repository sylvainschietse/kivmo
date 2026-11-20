import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* Conventions : identifiant uuid, created_at / updated_at en UTC, `version` pour le verrou optimiste.
   Montants : numeric (jamais de flottant binaire). */
const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const version = () => integer("version").notNull().default(1);
const money = (name: string) => numeric(name, { precision: 14, scale: 4 });
const liters = (name: string) => numeric(name, { precision: 12, scale: 3 });
const unitPrice = (name: string) => numeric(name, { precision: 10, scale: 4 });
const km = (name: string) => numeric(name, { precision: 12, scale: 1 });

export const accountKind = pgEnum("account_kind", ["particulier", "independant", "entreprise"]);
export const orgRole = pgEnum("org_role", ["owner", "fleet_admin", "manager", "driver", "accountant"]);
export const orgKind = pgEnum("org_kind", ["foyer", "entreprise", "partenaire"]);
export const fuelCode = pgEnum("fuel_code", ["E85", "SP95", "SP95_E10", "SP98", "GAZOLE", "GPL", "ELEC_KWH"]);
export const fillupSource = pgEnum("fillup_source", ["manual", "ocr", "dictation", "import", "offline_sync", "demo"]);
export const approvalStatus = pgEnum("approval_status", ["not_required", "submitted", "to_complete", "validated", "rejected"]);
export const usageKind = pgEnum("usage_kind", ["personnel", "professionnel", "mixte"]);
export const availabilityState = pgEnum("availability_state", ["propose", "rupture_signalee", "disponible_signale", "inconnu"]);
export const paymentState = pgEnum("payment_state", ["draft", "to_authorize", "submitted", "pending", "confirmed", "failed", "cancelled", "unknown"]);
export const savingsKind = pgEnum("savings_kind", ["declared_manual", "bank_confirmed"]);
export const quoteStatus = pgEnum("quote_status", ["brouillon", "envoye", "recu", "contacte", "devis", "installation", "clos"]);
export const reportStatus = pgEnum("report_status", ["en_attente", "accepte", "rejete", "expire"]);

/* ───────────── Identité ───────────── */

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull(),
  passwordHash: text("password_hash"),
  displayName: text("display_name"),
  accountKind: accountKind("account_kind").notNull().default("particulier"),
  isDemo: boolean("is_demo").notNull().default(false),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  status: text("status").notNull().default("active"),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)]);

export const profiles = pgTable("profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  locale: text("locale").notNull().default("fr-FR"),
  timeZone: text("time_zone").notNull().default("Europe/Paris"),
  currency: text("currency").notNull().default("EUR"),
  country: text("country").notNull().default("FR"),
  theme: text("theme").notNull().default("system"),
  deductConversionBeforeAllocation: boolean("deduct_conversion_before_allocation").notNull().default(true),
  activeVehicleId: uuid("active_vehicle_id"),
  homeLat: doublePrecision("home_lat"),
  homeLng: doublePrecision("home_lng"),
  homeLabel: text("home_label"),
  preferredNavApp: text("preferred_nav_app").notNull().default("google"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const authTokens = pgTable("auth_tokens", {
  id: id(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("auth_tokens_hash_uq").on(t.tokenHash)]);

export const sessions = pgTable("sessions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("sessions_hash_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)]);

/* ───────────── Organisations ───────────── */

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  kind: orgKind("kind").notNull().default("entreprise"),
  country: text("country").notNull().default("FR"),
  currency: text("currency").notNull().default("EUR"),
  isDemo: boolean("is_demo").notNull().default(false),
  accountingFields: jsonb("accounting_fields").$type<{ key: string; label: string }[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  version: version(),
});

export const memberships = pgTable("memberships", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: orgRole("role").notNull(),
  /** Périmètre facultatif : équipe/agence pour un gestionnaire. */
  teamId: uuid("team_id"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("memberships_org_user_uq").on(t.organizationId, t.userId)]);

export const teams = pgTable("teams", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("equipe"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const invitations = pgTable("invitations", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: orgRole("role").notNull(),
  tokenHash: text("token_hash").notNull(),
  invitedBy: uuid("invited_by").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("invitations_hash_uq").on(t.tokenHash)]);

/* ───────────── Véhicules ───────────── */

export const vehicles = pgTable("vehicles", {
  id: id(),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  make: text("make"),
  model: text("model"),
  year: integer("year"),
  engine: text("engine"),
  energy: text("energy").notNull().default("essence"),
  tankCapacityL: liters("tank_capacity_l"),
  initialOdometerKm: km("initial_odometer_km").notNull().default("0"),
  photoAttachmentId: uuid("photo_attachment_id"),
  currency: text("currency").notNull().default("EUR"),
  country: text("country").notNull().default("FR"),
  plate: text("plate"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  version: version(),
}, (t) => [
  check("vehicles_owner_ck", sql`(${t.ownerUserId} is not null) <> (${t.organizationId} is not null)`),
  index("vehicles_owner_idx").on(t.ownerUserId),
  index("vehicles_org_idx").on(t.organizationId),
]);

export const vehicleAssignments = pgTable("vehicle_assignments", {
  id: id(),
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  startOdometerKm: km("start_odometer_km"),
  endOdometerKm: km("end_odometer_km"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("assignments_vehicle_idx").on(t.vehicleId, t.startsAt)]);

/** Compteur remplacé : décalage historisé appliqué aux relevés postérieurs. */
export const odometerEvents = pgTable("odometer_events", {
  id: id(),
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("replacement"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  oldReadingKm: km("old_reading_km").notNull(),
  newReadingKm: km("new_reading_km").notNull(),
  note: text("note"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("odometer_events_vehicle_idx").on(t.vehicleId, t.occurredAt)]);

export const conversions = pgTable("conversions", {
  id: id(),
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
  declaredType: text("declared_type").notNull(),
  date: date("date").notNull(),
  odometerKm: km("odometer_km").notNull(),
  cost: money("cost").notNull(),
  provider: text("provider"),
  partnerId: uuid("partner_id"),
  note: text("note"),
  /** Saisie déclarative : ne vaut pas validation réglementaire ou technique. */
  isDeclarative: boolean("is_declarative").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  version: version(),
});

export const referenceProfiles = pgTable("reference_profiles", {
  id: id(),
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
  /** Version incrémentale : on historise au lieu de réécrire le passé. */
  profileVersion: integer("profile_version").notNull(),
  kind: text("kind").notNull().default("ancien_vehicule"),
  label: text("label").notNull(),
  fuel: fuelCode("fuel").notNull(),
  consumptionL100: numeric("consumption_l100", { precision: 6, scale: 3 }).notNull(),
  priceMode: text("price_mode").notNull().default("observed"),
  fixedPrice: unitPrice("fixed_price"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
  method: text("method"),
  confidence: text("confidence").notNull().default("moyenne"),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("reference_profiles_vehicle_version_uq").on(t.vehicleId, t.profileVersion)]);

/* ───────────── Stations et prix ───────────── */

export const stations = pgTable("stations", {
  id: id(),
  source: text("source").notNull(),
  sourceId: text("source_id").notNull(),
  name: text("name"),
  brand: text("brand"),
  address: text("address"),
  postalCode: text("postal_code"),
  city: text("city"),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  services: jsonb("services").$type<string[]>().notNull().default([]),
  payment: jsonb("payment").$type<string[]>().notNull().default([]),
  openingHours: jsonb("opening_hours").$type<Record<string, string> | null>(),
  isAlwaysOpen: boolean("is_always_open"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("stations_source_uq").on(t.source, t.sourceId),
  index("stations_coords_idx").on(t.lat, t.lng),
]);

export const stationFuels = pgTable("station_fuels", {
  id: id(),
  stationId: uuid("station_id").notNull().references(() => stations.id, { onDelete: "cascade" }),
  fuel: fuelCode("fuel").notNull(),
  /** Proposé par la source : ne prouve pas la disponibilité. */
  availability: availabilityState("availability").notNull().default("propose"),
  availabilitySince: timestamp("availability_since", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("station_fuels_uq").on(t.stationId, t.fuel)]);

export const priceObservations = pgTable("price_observations", {
  id: id(),
  stationId: uuid("station_id").notNull().references(() => stations.id, { onDelete: "cascade" }),
  fuel: fuelCode("fuel").notNull(),
  price: unitPrice("price").notNull(),
  currency: text("currency").notNull().default("EUR"),
  source: text("source").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  quality: text("quality").notNull().default("officielle"),
  reportedBy: uuid("reported_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [
  index("price_obs_station_fuel_date_idx").on(t.stationId, t.fuel, t.observedAt),
  uniqueIndex("price_obs_dedupe_uq").on(t.stationId, t.fuel, t.source, t.observedAt),
]);

export const availabilityReports = pgTable("availability_reports", {
  id: id(),
  stationId: uuid("station_id").notNull().references(() => stations.id, { onDelete: "cascade" }),
  fuel: fuelCode("fuel"),
  kind: text("kind").notNull(), // rupture | disponible | prix | fermeture
  reportedPrice: unitPrice("reported_price"),
  source: text("source").notNull().default("communaute"),
  reportedBy: uuid("reported_by").references(() => users.id, { onDelete: "set null" }),
  proofAttachmentId: uuid("proof_attachment_id"),
  status: reportStatus("status").notNull().default("en_attente"),
  moderatedBy: uuid("moderated_by").references(() => users.id),
  moderationNote: text("moderation_note"),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [index("availability_reports_station_idx").on(t.stationId, t.observedAt)]);

export const favoriteStations = pgTable("favorite_stations", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  stationId: uuid("station_id").notNull().references(() => stations.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("favorite_stations_uq").on(t.userId, t.stationId)]);

/* ───────────── Pleins ───────────── */

export const attachments = pgTable("attachments", {
  id: id(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // ticket | compteur | conversion | entretien | preuve | photo
  storageKey: text("storage_key").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  ocrResult: jsonb("ocr_result"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("attachments_owner_hash_uq").on(t.ownerUserId, t.sha256, t.kind)]);

export const fillups = pgTable("fillups", {
  id: id(),
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  driverUserId: uuid("driver_user_id").references(() => users.id),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  localDate: date("local_date").notNull(),
  odometerKm: km("odometer_km").notNull(),
  isFull: boolean("is_full").notNull(),
  startsNewBaseline: boolean("starts_new_baseline").notNull().default(false),
  missedBefore: boolean("missed_before").notNull().default(false),
  stationId: uuid("station_id").references(() => stations.id, { onDelete: "set null" }),
  stationLabel: text("station_label"),
  totalPaid: money("total_paid").notNull(),
  displayedTotal: money("displayed_total"),
  discount: money("discount").notNull().default("0"),
  currency: text("currency").notNull().default("EUR"),
  usage: usageKind("usage").notNull().default("personnel"),
  category: text("category"),
  source: fillupSource("source").notNull().default("manual"),
  receiptAttachmentId: uuid("receipt_attachment_id").references(() => attachments.id, { onDelete: "set null" }),
  odometerAttachmentId: uuid("odometer_attachment_id").references(() => attachments.id, { onDelete: "set null" }),
  /** Instantané du prix de référence au moment de l'achat : l'évolution des API ne modifie pas le passé. */
  refPriceFuel: fuelCode("ref_price_fuel"),
  refPrice: unitPrice("ref_price"),
  refPriceSource: text("ref_price_source"),
  refPriceObservedAt: timestamp("ref_price_observed_at", { withTimezone: true }),
  approvalStatus: approvalStatus("approval_status").notNull().default("not_required"),
  approvalReason: text("approval_reason"),
  reimbursable: boolean("reimbursable").notNull().default(false),
  reimbursedAt: timestamp("reimbursed_at", { withTimezone: true }),
  accountingFields: jsonb("accounting_fields").$type<Record<string, string>>().notNull().default({}),
  correctsFillupId: uuid("corrects_fillup_id"),
  correctionNote: text("correction_note"),
  idempotencyKey: text("idempotency_key"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedReason: text("deleted_reason"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  version: version(),
}, (t) => [
  index("fillups_vehicle_odo_idx").on(t.vehicleId, t.odometerKm),
  index("fillups_vehicle_date_idx").on(t.vehicleId, t.occurredAt),
  index("fillups_org_date_idx").on(t.organizationId, t.occurredAt),
  uniqueIndex("fillups_idem_uq").on(t.createdBy, t.idempotencyKey),
  uniqueIndex("fillups_receipt_uq").on(t.receiptAttachmentId).where(sql`${t.deletedAt} is null`),
  check("fillups_total_ck", sql`${t.totalPaid} >= 0`),
]);

export const fillupLines = pgTable("fillup_lines", {
  id: id(),
  fillupId: uuid("fillup_id").notNull().references(() => fillups.id, { onDelete: "cascade" }),
  fuel: fuelCode("fuel").notNull(),
  liters: liters("liters").notNull(),
  displayedUnitPrice: unitPrice("displayed_unit_price"),
  amountPaid: money("amount_paid").notNull(),
  createdAt: createdAt(),
}, (t) => [check("fillup_lines_liters_ck", sql`${t.liters} > 0`), index("fillup_lines_fillup_idx").on(t.fillupId)]);

/** Résultats figés et reproductibles (version de calcul), recalculés après chaque modification. */
export const consumptionIntervals = pgTable("consumption_intervals", {
  id: id(),
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
  startFillupId: uuid("start_fillup_id").notNull(),
  endFillupId: uuid("end_fillup_id").notNull(),
  includedFillupIds: jsonb("included_fillup_ids").$type<string[]>().notNull(),
  distanceKm: km("distance_km").notNull(),
  volumeL: liters("volume_l").notNull(),
  cost: money("cost").notNull(),
  consumptionL100: numeric("consumption_l100", { precision: 10, scale: 4 }),
  costPer100: money("cost_per_100"),
  status: text("status").notNull(),
  issues: jsonb("issues").$type<string[]>().notNull().default([]),
  closedAt: timestamp("closed_at", { withTimezone: true }).notNull(),
  calcVersion: text("calc_version").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("consumption_intervals_end_uq").on(t.vehicleId, t.endFillupId)]);

export const comparisonResults = pgTable("comparison_results", {
  id: id(),
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
  intervalEndFillupId: uuid("interval_end_fillup_id").notNull(),
  profileId: uuid("profile_id"),
  profileVersion: integer("profile_version"),
  status: text("status").notNull(),
  basis: text("basis").notNull().default("measured"),
  referencePrice: unitPrice("reference_price"),
  priceMethod: text("price_method"),
  referenceCost: money("reference_cost"),
  actualCost: money("actual_cost").notNull(),
  gain: money("gain"),
  missingReason: text("missing_reason"),
  calcVersion: text("calc_version").notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("comparison_results_end_uq").on(t.vehicleId, t.intervalEndFillupId)]);

/* ───────────── Projets et épargne ───────────── */

export const projects = pgTable("projects", {
  id: id(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  imageAttachmentId: uuid("image_attachment_id"),
  emoji: text("emoji"),
  target: money("target"),
  targetDate: date("target_date"),
  priority: integer("priority").notNull().default(1),
  visibility: text("visibility").notNull().default("prive"),
  sharePercent: numeric("share_percent", { precision: 7, scale: 4 }),
  shareFixedAmount: money("share_fixed_amount"),
  isPrimary: boolean("is_primary").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  version: version(),
});

export const projectParticipants = pgTable("project_participants", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("contributeur"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("project_participants_uq").on(t.projectId, t.userId)]);

/** Affectation théorique de gains : un même euro ne peut être affecté qu'une fois (contrôle transactionnel). */
export const allocations = pgTable("allocations", {
  id: id(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  amount: money("amount").notNull(),
  basisSnapshot: jsonb("basis_snapshot").notNull(),
  batchId: uuid("batch_id").notNull(),
  createdAt: createdAt(),
}, (t) => [index("allocations_owner_idx").on(t.ownerUserId, t.createdAt), check("allocations_amount_ck", sql`${t.amount} > 0`)]);

export const savingsEntries = pgTable("savings_entries", {
  id: id(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  kind: savingsKind("kind").notNull(),
  amount: money("amount").notNull(),
  occurredOn: date("occurred_on").notNull(),
  paymentOrderId: uuid("payment_order_id"),
  provenance: text("provenance").notNull(),
  note: text("note"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("savings_entries_order_uq").on(t.paymentOrderId),
  check("savings_amount_ck", sql`${t.amount} > 0`),
]);

export const savingsRules = pgTable("savings_rules", {
  id: id(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  mode: text("mode").notNull().default("manuel"), // manuel | prepare | automatique
  frequency: text("frequency").notNull().default("mensuelle"),
  minimumAmount: money("minimum_amount").notNull().default("10"),
  capAmount: money("cap_amount"),
  bankConnectionId: uuid("bank_connection_id"),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  version: version(),
}, (t) => [uniqueIndex("savings_rules_owner_uq").on(t.ownerUserId)]);

export const bankConnections = pgTable("bank_connections", {
  id: id(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  environment: text("environment").notNull(), // sandbox | production
  /** Références opaques du prestataire : jamais d'identifiant ni de mot de passe bancaire. */
  providerConnectionRef: text("provider_connection_ref").notNull(),
  accountLabel: text("account_label"),
  ibanMasked: text("iban_masked"),
  ownershipVerified: boolean("ownership_verified").notNull().default(false),
  canReadTransactions: boolean("can_read_transactions").notNull().default(false),
  canInitiatePayments: boolean("can_initiate_payments").notNull().default(false),
  consentRecordId: uuid("consent_record_id"),
  consentExpiresAt: timestamp("consent_expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  version: version(),
});

export const paymentOrders = pgTable("payment_orders", {
  id: id(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  bankConnectionId: uuid("bank_connection_id").notNull().references(() => bankConnections.id),
  amount: money("amount").notNull(),
  currency: text("currency").notNull().default("EUR"),
  state: paymentState("state").notNull().default("draft"),
  idempotencyKey: text("idempotency_key").notNull(),
  providerOrderRef: text("provider_order_ref"),
  authorizationUrl: text("authorization_url"),
  feesNotice: text("fees_notice"),
  lastError: text("last_error"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  version: version(),
}, (t) => [
  uniqueIndex("payment_orders_idem_uq").on(t.ownerUserId, t.idempotencyKey),
  uniqueIndex("payment_orders_provider_ref_uq").on(t.providerOrderRef),
  /** Un seul ordre non terminé par utilisateur : aucun nouvel ordre tant qu'une tentative est incertaine. */
  uniqueIndex("payment_orders_one_open_uq").on(t.ownerUserId).where(sql`${t.state} in ('draft','to_authorize','submitted','pending','unknown')`),
  check("payment_orders_amount_ck", sql`${t.amount} > 0`),
]);

export const paymentEvents = pgTable("payment_events", {
  id: id(),
  paymentOrderId: uuid("payment_order_id").references(() => paymentOrders.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerEventId: text("provider_event_id").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  signatureValid: boolean("signature_valid").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (t) => [uniqueIndex("payment_events_provider_uq").on(t.provider, t.providerEventId)]);

/* ───────────── Entreprise ───────────── */

export const budgets = pgTable("budgets", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(), // flotte | equipe | vehicule
  scopeId: uuid("scope_id"),
  period: text("period").notNull(), // mensuel | annuel
  amount: money("amount").notNull(),
  alertThresholdPercent: integer("alert_threshold_percent").notNull().default(80),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  version: version(),
});

export const approvals = pgTable("approvals", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  fillupId: uuid("fillup_id").notNull().references(() => fillups.id, { onDelete: "cascade" }),
  decidedBy: uuid("decided_by").notNull().references(() => users.id),
  decision: approvalStatus("decision").notNull(),
  reason: text("reason"),
  createdAt: createdAt(),
});

export const accountingPeriods = pgTable("accounting_periods", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedBy: uuid("closed_by").references(() => users.id),
  reopenedAt: timestamp("reopened_at", { withTimezone: true }),
  reopenedBy: uuid("reopened_by").references(() => users.id),
  reopenReason: text("reopen_reason"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  version: version(),
}, (t) => [uniqueIndex("accounting_periods_uq").on(t.organizationId, t.startsOn)]);

export const maintenanceEvents = pgTable("maintenance_events", {
  id: id(),
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // entretien | controle_technique | pneus | reparation | immobilisation
  occurredOn: date("occurred_on").notNull(),
  odometerKm: km("odometer_km"),
  cost: money("cost"),
  downtimeDays: integer("downtime_days"),
  attachmentId: uuid("attachment_id"),
  note: text("note"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const reminders = pgTable("reminders", {
  id: id(),
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  dueOn: date("due_on"),
  dueOdometerKm: km("due_odometer_km"),
  doneAt: timestamp("done_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ───────────── Notifications ───────────── */

export const notifications = pgTable("notifications", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  link: text("link"),
  dedupeKey: text("dedupe_key").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("notifications_dedupe_uq").on(t.userId, t.dedupeKey), index("notifications_user_idx").on(t.userId, t.createdAt)]);

export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  kinds: jsonb("kinds").$type<Record<string, boolean>>().notNull().default({}),
  channels: jsonb("channels").$type<{ inApp: boolean; push: boolean; email: boolean }>().notNull().default({ inApp: true, push: false, email: false }),
  quietStart: text("quiet_start").notNull().default("21:00"),
  quietEnd: text("quiet_end").notNull().default("08:00"),
  maxPerDay: integer("max_per_day").notNull().default(5),
  updatedAt: updatedAt(),
});

/* ───────────── Partenaires ───────────── */

export const partners = pgTable("partners", {
  id: id(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("garage"),
  services: jsonb("services").$type<string[]>().notNull().default([]),
  zones: jsonb("zones").$type<string[]>().notNull().default([]),
  city: text("city"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  brandColor: text("brand_color"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const quoteRequests = pgTable("quote_requests", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
  need: text("need").notNull(),
  zone: text("zone").notNull(),
  contactChannel: text("contact_channel").notNull(),
  contactValue: text("contact_value").notNull(),
  vehicleSummary: text("vehicle_summary"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const requestRecipients = pgTable("request_recipients", {
  id: id(),
  quoteRequestId: uuid("quote_request_id").notNull().references(() => quoteRequests.id, { onDelete: "cascade" }),
  partnerId: uuid("partner_id").notNull().references(() => partners.id, { onDelete: "cascade" }),
  consentRecordId: uuid("consent_record_id").notNull(),
  status: quoteStatus("status").notNull().default("envoye"),
  statusHistory: jsonb("status_history").$type<{ status: string; at: string; by: string }[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("request_recipients_uq").on(t.quoteRequestId, t.partnerId)]);

export const sponsoredOffers = pgTable("sponsored_offers", {
  id: id(),
  partnerId: uuid("partner_id").references(() => partners.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  url: text("url"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
});

export const subscriptions = pgTable("subscriptions", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  plan: text("plan").notNull(),
  /** Tarif configurable, jamais inventé : null tant que non décidé. */
  priceAmount: money("price_amount"),
  provider: text("provider"),
  providerRef: text("provider_ref"),
  status: text("status").notNull().default("a_connecter"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const referralEvents = pgTable("referral_events", {
  id: id(),
  referrerUserId: uuid("referrer_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Aucun lien vers les données du filleul : seul un statut agrégé est conservé. */
  code: text("code").notNull(),
  status: text("status").notNull().default("invite"),
  createdAt: createdAt(),
});

/* ───────────── Transverse ───────────── */

export const auditEvents = pgTable("audit_events", {
  id: id(),
  actorUserId: uuid("actor_user_id"),
  organizationId: uuid("organization_id"),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id"),
  /** Jamais de secret, d'IBAN complet ni de jeton. */
  details: jsonb("details").notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index("audit_events_resource_idx").on(t.resourceType, t.resourceId), index("audit_events_org_idx").on(t.organizationId, t.createdAt)]);

export const importJobs = pgTable("import_jobs", {
  id: id(),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("en_cours"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  stats: jsonb("stats").notNull().default({}),
  error: text("error"),
});

export const exportJobs = pgTable("export_jobs", {
  id: id(),
  requestedBy: uuid("requested_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id"),
  format: text("format").notNull(),
  filters: jsonb("filters").notNull().default({}),
  rowCount: integer("row_count"),
  createdAt: createdAt(),
});

export const integrationHealth = pgTable("integration_health", {
  key: text("key").primaryKey(),
  status: text("status").notNull(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  lastError: text("last_error"),
  metrics: jsonb("metrics").notNull().default({}),
  updatedAt: updatedAt(),
});

export const consentRecords = pgTable("consent_records", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(), // marketing | banque | localisation | partage_partenaire | mesure_audience
  scope: text("scope"),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  textVersion: text("text_version").notNull(),
}, (t) => [index("consent_records_user_idx").on(t.userId, t.purpose)]);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});

/** Bac à sable bancaire intégré : simule le prestataire (jamais utilisé en production). */
export const sandboxBankPayments = pgTable("sandbox_bank_payments", {
  providerRef: text("provider_ref").primaryKey(),
  state: paymentState("state").notNull(),
  amount: money("amount").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("sandbox_bank_idem_uq").on(t.idempotencyKey)]);
