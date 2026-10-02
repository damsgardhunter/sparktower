/**
 * Saving a picture the product drew, on the web.
 *
 * Everything Nova generates is paid for, and until now none of it could be got
 * off the screen. The whole mechanism is one query parameter: `?download=1&as=`
 * on the URL the image is already served from makes the server send it as an
 * attachment with a sensible name, so this is a link rather than a fetch, a blob
 * and an object URL.
 *
 * A link also means the browser does the work: the progress, the downloads
 * shelf, the "keep" prompt, and a right-click menu that already says "Save link
 * as". Reimplementing any of that in JavaScript would be worse at it.
 *
 * `download` is set as well as the header, which is belt and braces: the
 * attribute only works same-origin, and the header works everywhere including
 * the in-app browser on a phone.
 */
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** `?download=1&as=<name>`, keeping whatever the URL already carried. */
export function downloadUrl(src: string, name: string): string {
  const [base, existing] = src.split("?");
  const params = new URLSearchParams(existing ?? "");
  /*
   * A width is dropped rather than left: the server ignores it on a download,
   * and leaving it in the URL suggests otherwise to whoever reads this next.
   */
  params.delete("w");
  params.set("download", "1");
  params.set("as", name);
  return `${base}?${params.toString()}`;
}

export function DownloadImage({
  src,
  name,
  label = "Download",
  size = "sm",
  variant = "outline",
  className,
  iconOnly,
  testId,
}: {
  /** The path the image is already served from, e.g. `/objects/uploads/…`. */
  src: string | null | undefined;
  /** What to call the file. Sanitised server-side; a project's own name is ideal. */
  name: string;
  label?: string;
  size?: "sm" | "default" | "icon";
  variant?: "outline" | "ghost" | "secondary" | "default";
  className?: string;
  iconOnly?: boolean;
  testId?: string;
}) {
  if (!src) return null;
  return (
    <Button asChild size={iconOnly ? "icon" : size} variant={variant} className={cn(className)}>
      <a
        href={downloadUrl(src, name)}
        download={name}
        /*
         * Not a new tab. An attachment response does not navigate, so a tab would
         * open and sit blank for ever — which is what makes a download look
         * broken on Safari.
         */
        data-testid={testId ?? "button-download-image"}
        aria-label={iconOnly ? `Download ${name}` : undefined}
      >
        <Download className={iconOnly ? "h-4 w-4" : "h-4 w-4 mr-1.5"} />
        {iconOnly ? null : label}
      </a>
    </Button>
  );
}
