interface CodeDisplayProps {
  code: string;
  language?: string;
}

export function CodeDisplay({ code, language = "javascript" }: CodeDisplayProps) {
  return (
    <div className="relative rounded-md overflow-hidden bg-slate-950 p-4 font-mono text-sm text-slate-50 border border-border">
      <div className="flex items-center justify-between mb-2 text-slate-400 text-xs uppercase tracking-wider">
        <span>{language}</span>
      </div>
      <pre className="overflow-x-auto">
        <code data-testid="text-code-snippet">{code}</code>
      </pre>
    </div>
  );
}
