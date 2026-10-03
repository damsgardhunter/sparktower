/**
 * "Save" on a picture Nova drew, on a phone.
 *
 * The web's version is a link and the browser does the work. A phone has no
 * downloads folder, so this fetches the bytes with the session, puts them in the
 * camera roll — where people look for a picture afterwards — and says so.
 * `src/saveImage.ts` holds that, including the fallback to the share sheet when
 * somebody has said no to the photo library.
 *
 * The button owns its own state rather than taking a mutation from above: every
 * surface that shows a generated image wants this, and none of them should have
 * to carry three lines of saving state to get it.
 */
import { useState } from "react";
import { Pressable } from "react-native";
import { Btn, Icon } from "./ui";
import { colors } from "../theme";
import { useNotice, NoticeBanner } from "./Sheet";
import { saveImage } from "../saveImage";

export function SaveImage({
  path,
  name,
  label = "Save",
  small = true,
  variant = "outline",
  iconOnly,
  testID,
}: {
  /** The path the image is served from, e.g. `/objects/uploads/…`. */
  path: string | null | undefined;
  /** What to call it. The project's own name reads best in the share sheet. */
  name: string;
  label?: string;
  small?: boolean;
  variant?: "primary" | "outline" | "ghost";
  /** An icon on its own, for a row of icon actions rather than a row of buttons. */
  iconOnly?: boolean;
  testID?: string;
}) {
  const [busy, setBusy] = useState(false);
  const { notice, show, clear } = useNotice();

  if (!path) return null;

  const run = async () => {
    setBusy(true);
    const result = await saveImage({ path, name });
    setBusy(false);
    show(
      result.ok
        ? {
            /*
             * Which of the two happened, because they end somewhere different: a
             * photo in the camera roll, or whatever they chose from the sheet.
             */
            text: result.where === "photos" ? "Saved to your photos." : "Sent to share.",
            tone: "success",
          }
        : { text: result.reason, tone: "error" },
    );
  };

  if (iconOnly) {
    return (
      <>
        <Pressable
          hitSlop={6}
          disabled={busy}
          onPress={() => void run()}
          accessibilityRole="button"
          accessibilityLabel={`Save ${name}`}
          testID={testID ?? "button-save-image"}
        >
          <Icon name={busy ? "hourglass-outline" : "download-outline"} size={17} color={colors.primary} />
        </Pressable>
        <NoticeBanner notice={notice} onDismiss={clear} />
      </>
    );
  }

  return (
    <>
      <Btn
        label={label}
        icon="download-outline"
        small={small}
        variant={variant}
        loading={busy}
        onPress={() => void run()}
        testID={testID ?? "button-save-image"}
      />
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}
