"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  createRecordAction,
  deleteRecordAction,
  updateRecordAction,
} from "@/server/actions/master";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ACTOR } from "@/lib/config";
import { WEEKDAYS, defBySlug, type Field, type Lookups, type Row } from "./resources";

type Values = Record<string, unknown>;

/** Turn the form's raw values into what the server's Zod schema expects. */
function toInput(fields: Field[], v: Values): Values {
  const out: Values = {};
  for (const f of fields) {
    if (f.showWhen && !f.showWhen.in.includes(String(v[f.showWhen.field] ?? ""))) continue;
    const raw = v[f.name];
    switch (f.type) {
      case "number": {
        if (raw === "" || raw === undefined || raw === null) {
          if (!f.optional) out[f.name] = raw === "" ? undefined : raw;
          else out[f.name] = null;
        } else out[f.name] = Number(raw);
        break;
      }
      case "weekdayMin": {
        const rec = (raw ?? {}) as Record<string, string | number>;
        const filled = Object.entries(rec).filter(([, x]) => x !== "" && x !== undefined);
        out[f.name] =
          filled.length > 0 ? Object.fromEntries(filled.map(([k, x]) => [k, Number(x)])) : null;
        break;
      }
      case "weekdays":
        out[f.name] = Array.isArray(raw) ? raw : [];
        break;
      case "checkbox":
        out[f.name] = Boolean(raw);
        break;
      default:
        out[f.name] = raw === "" || raw === undefined ? (f.optional ? null : raw) : raw;
    }
  }
  return out;
}

function FieldInput({
  f,
  value,
  onChange,
  lookups,
  id,
}: {
  f: Field;
  value: unknown;
  onChange: (v: unknown) => void;
  lookups: Lookups;
  id: string;
}) {
  switch (f.type) {
    case "checkbox":
      return (
        <div className="flex items-center gap-2">
          <Checkbox
            id={id}
            checked={Boolean(value)}
            onCheckedChange={(c) => onChange(Boolean(c))}
          />
          <Label htmlFor={id} className="font-normal">
            {f.label}
          </Label>
        </div>
      );
    case "weekdays": {
      const sel = new Set((value as string[]) ?? []);
      return (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={f.label}>
          {WEEKDAYS.map((d) => (
            <label
              key={d}
              className={`flex cursor-pointer select-none items-center rounded-md border px-2 py-1 text-xs ${
                sel.has(d) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={sel.has(d)}
                onChange={() => {
                  const next = new Set(sel);
                  if (next.has(d)) next.delete(d);
                  else next.add(d);
                  onChange(WEEKDAYS.filter((x) => next.has(x)));
                }}
              />
              {d[0] + d.slice(1).toLowerCase()}
            </label>
          ))}
        </div>
      );
    }
    case "weekdayMin": {
      const rec = (value ?? {}) as Record<string, number | string>;
      return (
        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map((d) => (
            <div key={d} className="space-y-0.5">
              <div className="text-center text-[11px] text-muted-foreground">
                {d[0] + d.slice(1).toLowerCase()}
              </div>
              <Input
                aria-label={`Minimum on ${d}`}
                type="number"
                min={0}
                max={50}
                className="h-8 px-1.5 text-center"
                value={rec[d] ?? ""}
                onChange={(e) => onChange({ ...rec, [d]: e.target.value })}
              />
            </div>
          ))}
        </div>
      );
    }
    case "select":
      return (
        <NativeSelect
          id={id}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          {f.options!.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      );
    case "ref": {
      const opts = Object.entries(lookups[f.ref!] ?? {}).sort((a, b) => a[1].localeCompare(b[1]));
      return (
        <NativeSelect
          id={id}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{f.optional ? "None" : "Choose..."}</option>
          {opts.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </NativeSelect>
      );
    }
    default:
      return (
        <Input
          id={id}
          type={
            f.type === "number"
              ? "number"
              : f.type === "date"
                ? "date"
                : f.type === "time"
                  ? "time"
                  : "text"
          }
          min={f.min}
          max={f.max}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

export function ResourceManager({
  slug,
  rows,
  lookups,
}: {
  slug: string;
  rows: Row[];
  lookups: Lookups;
}) {
  const def = defBySlug(slug)!;
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ row: Row | null } | null>(null);
  const [values, setValues] = useState<Values>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      def.columns.some((c) => c.value(r, lookups).toLowerCase().includes(q)),
    );
  }, [rows, query, def, lookups]);

  function open(row: Row | null) {
    setError(null);
    setValues(
      row ? Object.fromEntries(def.fields.map((f) => [f.name, row[f.name]])) : { ...def.defaults },
    );
    setEditing({ row });
  }

  async function save() {
    setBusy(true);
    setError(null);
    const input = toInput(def.fields, values);
    const r = editing?.row
      ? await updateRecordAction(def.resource, editing.row.id, input, ACTOR)
      : await createRecordAction(def.resource, input, ACTOR);
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    setEditing(null);
    setNotice(`${editing?.row ? "Saved" : "Added"} ${def.singular}.`);
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    const r = await deleteRecordAction(def.resource, id, ACTOR);
    setBusy(false);
    setConfirmDelete(null);
    if (!r.ok) return setNotice(`Not deleted: ${r.error.message}`);
    setNotice(`Deleted ${def.singular}.`);
    router.refresh();
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{def.title}</h1>
          <p className="text-sm text-muted-foreground">{def.description}</p>
        </div>
        <Button onClick={() => open(null)}>
          <Plus /> Add {def.singular}
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Input
          aria-label={`Search ${def.title}`}
          placeholder={`Search ${def.title.toLowerCase()}...`}
          className="max-w-xs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="text-sm text-muted-foreground">
          {shown.length === rows.length
            ? `${rows.length} rows`
            : `${shown.length} of ${rows.length}`}
        </span>
        {notice && (
          <span role="status" className="text-sm text-foreground">
            {notice}
          </span>
        )}
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {def.columns.map((c) => (
                <TableHead key={c.label}>{c.label}</TableHead>
              ))}
              <TableHead className="w-28 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={def.columns.length + 1}
                  className="py-8 text-center text-muted-foreground"
                >
                  Nothing here yet.
                </TableCell>
              </TableRow>
            )}
            {shown.map((r) => (
              <TableRow key={r.id}>
                {def.columns.map((c) => (
                  <TableCell key={c.label}>{c.value(r, lookups)}</TableCell>
                ))}
                <TableCell className="text-right">
                  {confirmDelete === r.id ? (
                    <span className="inline-flex items-center gap-1">
                      <Button
                        size="xs"
                        variant="destructive"
                        disabled={busy}
                        onClick={() => remove(r.id)}
                      >
                        Delete
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(null)}>
                        Keep
                      </Button>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Edit ${def.singular}`}
                        onClick={() => open(r)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Delete ${def.singular}`}
                        onClick={() => setConfirmDelete(r.id)}
                      >
                        <Trash2 />
                      </Button>
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editing?.row ? "Edit" : "Add"} {def.singular}
            </DialogTitle>
            <DialogDescription>
              Saved changes apply to the next roster you generate or re-plan. Existing rosters are
              not rewritten.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {def.fields.map((f) => {
              if (f.showWhen && !f.showWhen.in.includes(String(values[f.showWhen.field] ?? "")))
                return null;
              const id = `f-${f.name}`;
              return (
                <div key={f.name} className="space-y-1.5">
                  {f.type !== "checkbox" && <Label htmlFor={id}>{f.label}</Label>}
                  <FieldInput
                    id={id}
                    f={f}
                    value={values[f.name]}
                    lookups={lookups}
                    onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))}
                  />
                  {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
                </div>
              );
            })}
            {error && (
              <p
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
