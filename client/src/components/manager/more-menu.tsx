/** The section tab row: Dashboard, Roadmap, Tasks, Files, Analytics, then More for everything else. */
import { ChevronDown, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SECTION_TABS, MORE_TABS, type TabId, type TabDef } from "./tabs";
import { useSurfaces } from "@/hooks/use-surfaces";

const tabClass = (active: boolean) =>
  `relative inline-flex items-center gap-1.5 whitespace-nowrap px-2 sm:px-3 py-2.5 text-[13px] sm:text-sm font-medium transition-colors border-b-2 -mb-px outline-none focus-visible:bg-muted ${
    active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
  }`;

export function SectionTabRow({ active, onSelect, isOwner }: {
  active: TabId;
  onSelect: (tab: TabId) => void;
  isOwner: boolean;
}) {
  const { on } = useSurfaces();
  const more = MORE_TABS.filter((t) => (!t.ownerOnly || isOwner) && (!t.surface || on(t.surface)));
  return (
    <div className="flex items-end border-b border-border" data-testid="section-tab-row">
      <div className="flex items-end min-w-0 flex-1 sm:flex-none overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Section tabs">
        {SECTION_TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={active === t.id} className={tabClass(active === t.id)} onClick={() => onSelect(t.id)} data-testid={`section-tab-${t.id}`}>
            <t.icon className="hidden sm:block h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>
      <div className="shrink-0 border-l border-border sm:border-l-0">
        <MoreMenu tabs={more} active={active} onSelect={onSelect} />
      </div>
    </div>
  );
}

export function MoreMenu({ tabs, active, onSelect }: { tabs: TabDef[]; active: TabId; onSelect: (tab: TabId) => void }) {
  const current = tabs.find((t) => t.id === active);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={tabClass(!!current)} data-testid="more-menu">
          {current ? <current.icon className="hidden sm:block h-4 w-4" /> : <MoreHorizontal className="hidden sm:block h-4 w-4" />}
          {current ? current.label : "More"}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" onCloseAutoFocus={(e) => e.preventDefault()}>
        {tabs.map((t) => (
          <DropdownMenuItem key={t.id} onSelect={() => onSelect(t.id)} className={`gap-2 ${active === t.id ? "bg-accent font-medium" : ""}`} data-testid={`more-tab-${t.id}`}>
            <t.icon className="h-4 w-4 text-muted-foreground" />
            {t.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
