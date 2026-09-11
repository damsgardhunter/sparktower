/**
 * A build packet's run steps, as blocks to copy.
 *
 * What goes in each block, the break between them, and the exact text each
 * Copy button puts on the clipboard all come from the server
 * (shared/phase-trees/run-steps.ts) — the editor draws the same blocks, and
 * "run it all" has to mean the same thing in both. This only draws them.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Check, Copy, Globe, MousePointerClick, Terminal } from "lucide-react";
import type { RunGroup } from "@shared/phase-trees";

const ICON = {
  terminal: Terminal,
  "new-terminal": Terminal,
  "browser-console": Globe,
  browser: Globe,
  manual: MousePointerClick,
} as const;

function CopyBlock({ text, index }: { text: string; index: number }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm" variant="ghost" className="absolute top-1.5 right-1.5 h-7 px-2 text-xs"
      data-testid={`button-copy-run-${index}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast({ title: "Couldn't copy", description: "Select the text and copy it by hand.", variant: "destructive" });
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      <span className="ml-1">{copied ? "Copied" : "Copy"}</span>
    </Button>
  );
}

export function RunBlocks({ groups, steps }: { groups?: RunGroup[]; steps: string[] }) {
  // A server older than the blocks: the list, as it was.
  if (!groups?.length) {
    return <ol className="list-decimal pl-5 text-sm space-y-0.5">{steps.map((step, i) => <li key={i}>{step}</li>)}</ol>;
  }
  return (
    <div className="space-y-3" data-testid="run-blocks">
      {groups.map((group, i) => {
        const Icon = ICON[group.where] ?? Terminal;
        return (
          <div key={i} className="space-y-1.5">
            {group.before && (
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400 border-t border-border/60 pt-2" data-testid={`run-break-${i}`}>
                {group.before}
              </p>
            )}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{group.label}</span>
              {group.cwd && <code className="text-[11px]">in {group.cwd}/</code>}
            </div>
            {group.copy && (
              <div className="relative">
                <pre className="text-xs p-3 pr-20 overflow-x-auto rounded-md bg-muted/40 whitespace-pre" data-testid={`run-block-${i}`}>
                  <code>{group.copy}</code>
                </pre>
                <CopyBlock text={group.copy} index={i} />
              </div>
            )}
            {group.note && <p className="text-xs text-muted-foreground">{group.note}</p>}
          </div>
        );
      })}
    </div>
  );
}
