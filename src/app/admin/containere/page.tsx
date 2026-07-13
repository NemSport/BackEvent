"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { BackButton, PrimaryButton } from "@/components/backevent/buttons";
import {
  createLocation,
  deactivateLocationAdmin,
  deleteLocationAdmin,
  getLocationDeletePreview,
  getLocationsAdmin,
  updateLocation,
  type AdminDeletePreview,
} from "@/lib/backevent/data";
import type { Location } from "@/lib/backevent/types";

type LocationFormInput = {
  name: string;
  kind: Location["kind"];
  sourceLocationId?: string | null;
  isMainStorage?: boolean;
  active?: boolean;
  sortOrder?: number;
};

export default function AdminContainerePage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Location | null>(null);
  const [deletePreview, setDeletePreview] = useState<AdminDeletePreview | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function reload() {
    setLocations(await getLocationsAdmin());
  }

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        const loadedLocations = await getLocationsAdmin();
        if (mounted) {
          setLocations(loadedLocations);
        }
      } catch {
        if (mounted) {
          setMessage("Steder kunne ikke hentes.");
        }
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, []);

  async function saveLocation(input: LocationFormInput) {
    if (editingLocation) {
      await updateLocation(editingLocation.id, {
        ...input,
        sourceLocationId: input.sourceLocationId ?? null,
        isMainStorage: input.isMainStorage ?? false,
        active: input.active ?? true,
        sortOrder: input.sortOrder ?? editingLocation.sortOrder ?? 999,
      });
      setMessage("Sted gemt");
    } else {
      await createLocation(input);
      setMessage("Sted oprettet");
    }

    setEditingLocation(null);
    setIsCreating(false);
    await reload();
  }

  async function openDeleteLocation(location: Location) {
    setDeleteTarget(location);
    setDeletePreview(null);
    setMessage(null);
    try {
      setDeletePreview(await getLocationDeletePreview(location.id));
    } catch {
      setDeletePreview({ ok: false, message: "Sletteinfo kunne ikke hentes." });
    }
  }

  async function runDeleteLocation(action: "delete" | "deactivate") {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setMessage(null);
    try {
      const result = action === "delete" ? await deleteLocationAdmin(deleteTarget.id) : await deactivateLocationAdmin(deleteTarget.id);
      if (!result.ok) {
        setDeletePreview(result.plan && result.summary ? { ok: true, plan: result.plan, summary: result.summary } : { ok: false, message: result.message });
        setMessage(result.message);
        return;
      }
      setMessage(result.message);
      setDeleteTarget(null);
      setDeletePreview(null);
      if (editingLocation?.id === deleteTarget.id) setEditingLocation(null);
      await reload();
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <AppShell requiredRole="ejer">
      <BackButton href="/admin" />
      <section className="my-6 rounded-[2rem] bg-soft p-6 shadow-soft lg:my-5 lg:rounded-[1.5rem] lg:p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold text-ink">Steder</h1>
            <p className="mt-2 text-lg font-medium text-muted">Opret og ret lager/container og barer</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditingLocation(null);
              setIsCreating(true);
            }}
            className="min-h-11 rounded-2xl bg-pantone139 px-4 py-2 text-base font-bold text-ink shadow-soft"
          >
            Opret sted
          </button>
        </div>
      </section>

      {message ? <p className="mb-4 rounded-2xl bg-soft p-4 text-base font-bold text-pantone140">{message}</p> : null}

      <section className="overflow-hidden rounded-[1.5rem] border border-line bg-macro shadow-soft">
        <div className="hidden grid-cols-[1.4fr_0.8fr_1.2fr_0.7fr_0.8fr_0.6fr_0.7fr] gap-3 border-b border-line bg-soft px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted xl:grid">
          <span>Navn</span>
          <span>Type</span>
          <span>Trækker lager fra</span>
          <span>Sortering</span>
          <span>Hovedlager</span>
          <span>Aktiv</span>
          <span>Handling</span>
        </div>
        <div className="divide-y divide-line">
          {locations.map((location) => (
            <LocationRow
              key={location.id}
              location={location}
              locations={locations}
              onEdit={() => setEditingLocation(location)}
              onDelete={() => openDeleteLocation(location)}
            />
          ))}
        </div>
      </section>

      {isCreating || editingLocation ? (
        <LocationModal
          location={editingLocation ?? undefined}
          locations={locations}
          onClose={() => {
            setEditingLocation(null);
            setIsCreating(false);
          }}
          onSave={saveLocation}
          onDelete={editingLocation ? () => openDeleteLocation(editingLocation) : undefined}
        />
      ) : null}
      {deleteTarget ? (
        <DeleteObjectModal
          name={deleteTarget.name}
          objectLabel="sted"
          preview={deletePreview}
          isWorking={isDeleting}
          onClose={() => {
            setDeleteTarget(null);
            setDeletePreview(null);
          }}
          onDelete={() => runDeleteLocation("delete")}
          onDeactivate={() => runDeleteLocation("deactivate")}
        />
      ) : null}
    </AppShell>
  );
}

function LocationRow({ location, locations, onEdit, onDelete }: { location: Location; locations: Location[]; onEdit: () => void; onDelete: () => void }) {
  const source = locations.find((item) => item.id === location.sourceLocationId);

  return (
    <article className="grid gap-2 px-4 py-3 text-sm font-medium text-ink xl:grid-cols-[1.4fr_0.8fr_1.2fr_0.7fr_0.8fr_0.6fr_0.7fr] xl:items-center">
      <div>
        <p className="font-bold">{location.name}</p>
        <p className="text-xs text-muted xl:hidden">{locationTypeLabel(location.kind)}</p>
      </div>
      <span className="hidden xl:block">{locationTypeLabel(location.kind)}</span>
      <span className="text-muted xl:text-ink">{source?.name ?? "-"}</span>
      <span className="hidden xl:block">{location.sortOrder ?? "-"}</span>
      <span className="hidden xl:block">{location.isMainStorage ? "Ja" : "Nej"}</span>
      <span className="hidden xl:block">{location.active === false ? "Nej" : "Ja"}</span>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onEdit} className="w-fit rounded-xl bg-soft px-3 py-2 text-sm font-bold text-pantone140">
          Rediger
        </button>
        <button type="button" onClick={onDelete} className="w-fit rounded-xl bg-warmRed px-3 py-2 text-sm font-bold text-macro">
          Slet
        </button>
      </div>
    </article>
  );
}

function LocationModal({ location, locations, onClose, onSave, onDelete }: { location?: Location; locations: Location[]; onClose: () => void; onSave: (input: LocationFormInput) => Promise<void>; onDelete?: () => void }) {
  const [name, setName] = useState(location?.name ?? "");
  const [kind, setKind] = useState<"container" | "bar">(location?.kind === "container" ? "container" : "bar");
  const [sourceLocationId, setSourceLocationId] = useState(location?.sourceLocationId ?? "");
  const [isMainStorage, setIsMainStorage] = useState(location?.isMainStorage ?? false);
  const [active, setActive] = useState(location?.active ?? true);
  const [sortOrder, setSortOrder] = useState((location?.sortOrder ?? 999).toString());
  const [isSaving, setIsSaving] = useState(false);
  const sourceOptions = locations.filter((item) => item.id !== location?.id && item.active !== false);

  async function save() {
    setIsSaving(true);
    await onSave({
      name,
      kind,
      sourceLocationId: kind === "bar" ? sourceLocationId || null : null,
      isMainStorage,
      active,
      sortOrder: Number(sortOrder),
    });
    setIsSaving(false);
  }

  return (
    <Modal title={location ? "Rediger sted" : "Opret sted"} onClose={onClose}>
      <div className="grid gap-3 md:grid-cols-2">
        <Input label="Navn" value={name} onChange={setName} />
        <label className="block">
          <span className="text-base font-bold text-ink">Type</span>
          <select
            value={kind}
            onChange={(event) => {
              const nextKind = event.target.value as "container" | "bar";
              setKind(nextKind);
              if (nextKind === "container") {
                setSourceLocationId("");
              }
            }}
            className="mt-2 min-h-12 w-full rounded-2xl border border-line px-3 py-2 font-bold"
          >
            <option value="container">Lager/container</option>
            <option value="bar">Bar</option>
          </select>
        </label>
        {kind === "bar" ? (
          <label className="block">
            <span className="text-base font-bold text-ink">Trækker lager fra</span>
            <select value={sourceLocationId} onChange={(event) => setSourceLocationId(event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-line px-3 py-2 font-bold">
              <option value="">Intet valgt</option>
              {sourceOptions.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
        ) : null}
        <Input label="Sortering" value={sortOrder} onChange={setSortOrder} />
        <label className="flex items-center gap-2 text-lg font-bold text-ink">
          <input type="checkbox" checked={isMainStorage} onChange={(event) => setIsMainStorage(event.target.checked)} />
          Hovedlager
        </label>
        <label className="flex items-center gap-2 text-lg font-bold text-ink">
          <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
          Aktiv
        </label>
      </div>
      <div className="mt-5 flex gap-3">
        <PrimaryButton onClick={save} disabled={isSaving}>{isSaving ? "Gemmer..." : "Gem"}</PrimaryButton>
        {onDelete ? <button type="button" onClick={onDelete} className="min-h-11 rounded-2xl bg-warmRed px-4 py-2 font-bold text-macro">Slet</button> : null}
        <button type="button" onClick={onClose} className="min-h-11 rounded-2xl border border-line px-4 py-2 font-bold text-pantone140">Annuller</button>
      </div>
    </Modal>
  );
}

function DeleteObjectModal({
  name,
  objectLabel,
  preview,
  isWorking,
  onClose,
  onDelete,
  onDeactivate,
}: {
  name: string;
  objectLabel: string;
  preview: AdminDeletePreview | null;
  isWorking: boolean;
  onClose: () => void;
  onDelete: () => void;
  onDeactivate: () => void;
}) {
  const okPreview = preview?.ok ? preview : null;
  const plan = okPreview?.plan ?? null;
  return (
    <Modal title={`Slet ${objectLabel}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-base font-bold text-ink">
          Vil du slette {objectLabel}et <span className="text-warmRed">{name}</span>?
        </p>
        {!preview ? <p className="rounded-2xl bg-soft p-4 text-sm font-bold text-muted">Tjekker historik og beholdning...</p> : null}
        {preview && !preview.ok ? <p className="rounded-2xl bg-warmRed/10 p-4 text-sm font-bold text-warmRed">{preview.message}</p> : null}
        {plan ? (
          <div className="rounded-2xl border border-line bg-soft p-4">
            <p className="text-sm font-bold text-ink">{plan.reason}</p>
            {okPreview ? (
              <p className="mt-2 text-xs font-bold text-muted">
                Beholdning: {formatNumber(okPreview.summary.activeStockQuantity)} · Historik: {okPreview.summary.historyCount} · Relationer: {okPreview.summary.relationCount}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {plan?.action === "delete" ? (
            <button type="button" onClick={onDelete} disabled={isWorking} className="min-h-11 rounded-2xl bg-warmRed px-4 py-2 font-bold text-macro disabled:opacity-50">
              {isWorking ? "Sletter..." : "Slet permanent"}
            </button>
          ) : null}
          {plan?.canDeactivate ? (
            <button type="button" onClick={onDeactivate} disabled={isWorking} className="min-h-11 rounded-2xl border border-warmRed bg-macro px-4 py-2 font-bold text-warmRed disabled:opacity-50">
              {isWorking ? "Deaktiverer..." : "Deaktivér"}
            </button>
          ) : null}
          <button type="button" onClick={onClose} className="min-h-11 rounded-2xl border border-line px-4 py-2 font-bold text-pantone140">Annuller</button>
        </div>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 px-4 py-6">
      <section className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[1.5rem] bg-macro p-5 shadow-soft">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-2xl font-bold text-ink">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-xl bg-soft px-3 py-2 text-sm font-bold text-pantone140">Luk</button>
        </div>
        {children}
      </section>
    </div>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-base font-bold text-ink">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-line px-3 py-2 font-bold outline-none focus:border-pantone140" />
    </label>
  );
}

function locationTypeLabel(kind: Location["kind"]) {
  return kind === "container" ? "Lager/container" : "Bar";
}

function formatNumber(value: number) {
  return value.toLocaleString("da-DK", { maximumFractionDigits: 2 });
}
