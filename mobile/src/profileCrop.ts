/**
 * The shapes a profile picture is cut to on the phone.
 *
 * Its own module, with no imports at all, for one reason: `test/unit/mobile-mirror.test.ts`
 * compares these against the web's `CROP_PRESETS`, and it can only import a
 * mobile module that does not reach for React Native. `components/profilePhoto.ts`,
 * where these used to live, pulls in `expo-image-picker` and `Platform` through
 * `../photos` — which fails to even parse under the test runner's transform.
 *
 * The ratios have to match `client/src/lib/image-crop.ts`. Both clients crop
 * before uploading and store the result, so the ratio is baked into the file
 * rather than applied when it is shown: a cover framed 4:1 on one and 16:9 on the
 * other would land differently in the same band, and nothing would fail. Both
 * would look deliberate, and only side by side would either look wrong.
 */

/** `[x, y]` as `expo-image-picker` wants its `aspect`. */
export const CROP: Record<"avatar" | "cover", [number, number]> = {
  /** A round avatar, so square. */
  avatar: [1, 1],
  /** The cover band, which the profile renders as `aspect-[4/1]` on the web. */
  cover: [4, 1],
};
