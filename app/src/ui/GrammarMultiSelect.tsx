import { useMemo } from "react";
import Select, { type GroupBase, type StylesConfig } from "react-select";
import { allGrammarInv } from "../lib/inventory";

interface Option {
  value: string;
  label: string;
  locked: boolean;
}

interface Props {
  inputId?: string;
  value: string[];
  onChange: (ids: string[]) => void;
  /** Ids de grammaire des leçons débloquées, mis en avant dans un groupe dédié. */
  unlockedIds: Set<string>;
}

const styles: StylesConfig<Option, true, GroupBase<Option>> = {
  control: (base) => ({
    ...base,
    minHeight: "2.75rem",
  }),
};

/** Sélecteur multiple, filtrable, de règles de grammaire de l'inventaire. */
export function GrammarMultiSelect({ inputId, value, onChange, unlockedIds }: Props) {
  const groups = useMemo(() => {
    const all = allGrammarInv().map((g) => ({ value: g.id, label: g.name, locked: !unlockedIds.has(g.id) }));
    const unlocked = all.filter((o) => !o.locked);
    const rest = all.filter((o) => o.locked);
    const out: GroupBase<Option>[] = [];
    if (unlocked.length > 0) out.push({ label: "Débloquées", options: unlocked });
    out.push({ label: "Autres", options: rest });
    return out;
  }, [unlockedIds]);

  const byId = useMemo(() => new Map(groups.flatMap((g) => g.options).map((o) => [o.value, o])), [groups]);
  const selected = value.map((id) => byId.get(id)).filter((o): o is Option => o != null);

  return (
    <Select<Option, true, GroupBase<Option>>
      inputId={inputId}
      isMulti
      closeMenuOnSelect={false}
      options={groups}
      value={selected}
      onChange={(opts) => onChange(opts.map((o) => o.value))}
      placeholder="て-forme, は/が…"
      noOptionsMessage={() => "Aucune règle"}
      unstyled
      styles={styles}
      classNames={{
        control: () => "rounded-sm border border-hairline bg-bg p-2 leading-tight",
        placeholder: () => "text-muted",
        input: () => "text-text",
        valueContainer: () => "gap-1",
        multiValue: () => "flex items-center gap-1 rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-sm text-text",
        multiValueRemove: () => "cursor-pointer text-muted hover:text-accent",
        menu: () => "mt-1 rounded-sm border border-hairline bg-surface",
        groupHeading: () => "px-2 py-1 font-sans text-xs uppercase tracking-wider text-muted",
        option: ({ data, isFocused, isSelected }) =>
          `cursor-pointer px-2 py-2 text-sm ${
            isSelected ? "bg-accent text-on-accent" : isFocused ? "bg-surface-2 text-text" : data.locked ? "text-muted" : "text-text"
          }`,
        noOptionsMessage: () => "px-2 py-1 text-sm text-muted",
      }}
    />
  );
}
