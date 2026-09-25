import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { sized } from "@shared/image-size";

interface UserAvatarProps {
  src?: string | null;
  name?: string;
  className?: string;
  user?: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    profileImageUrl?: string | null;
    avatarUrl?: string | null;
  } | null;
  size?: "sm" | "default" | "lg";
}

export function UserAvatar({ src, name, className, user, size = "default" }: UserAvatarProps) {
  const resolvedName = name || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || undefined;
  /*
   * At 96 pixels, which is the largest this is ever drawn (48pt on a retina
   * screen). Without it every avatar on a page is the full photograph somebody
   * uploaded — a few megabytes each, in a circle the size of a thumbnail.
   */
  const resolvedSrc = sized(src || user?.avatarUrl || user?.profileImageUrl, 96);
  const initials = resolvedName
    ? resolvedName!
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
    : "U";

  return (
    <Avatar className={`${size === "sm" ? "h-8 w-8" : size === "lg" ? "h-12 w-12" : ""} ${className || ""}`}>
      {resolvedSrc && <AvatarImage src={resolvedSrc} alt={resolvedName || "User"} />}
      <AvatarFallback>{resolvedName ? initials : "U"}</AvatarFallback>
    </Avatar>
  );
}
