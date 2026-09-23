import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { Platform } from "react-native";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import { useQueryClient } from "@tanstack/react-query";
import {
  clearSession, fetchMe, getAccessToken, isMfaChallenge, login as apiLogin, loginWithGoogle,
  logout as apiLogout, register as apiRegister, setSessionExpiredHandler, verifyMfa as apiVerifyMfa,
  type MfaChallenge, type Session,
} from "../api/client";
import { captureAttribution } from "../api/attribution";

WebBrowser.maybeCompleteAuthSession();

/*
 * Google sign-in runs through expo-auth-session, which opens the system
 * browser. That's deliberate and required — Google rejects OAuth inside app
 * WebViews with `disallowed_useragent`.
 *
 * Each platform needs its own OAuth client, because the redirect URI is
 * derived from the app's bundle id. See mobile/.env.example.
 */
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

/**
 * The client id the provider will actually use here, mirroring its own
 * resolution order: this platform's id, falling back to the web id.
 *
 * Testing "is any id set" is not good enough — a build with only an Android
 * id would still blow up on iOS.
 */
const GOOGLE_CLIENT_ID =
  Platform.select({
    ios: GOOGLE_IOS_CLIENT_ID,
    android: GOOGLE_ANDROID_CLIENT_ID,
    default: GOOGLE_WEB_CLIENT_ID,
  }) ?? GOOGLE_WEB_CLIENT_ID;

const GOOGLE_CONFIGURED = Boolean(GOOGLE_CLIENT_ID);

interface AuthState {
  user: any | null;
  profile: any | null;
  /** True until the stored session has been checked on launch. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: { email: string; password: string; firstName?: string; lastName?: string }) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  /** True between a right password (or Google) and the code, for an account with 2FA on. */
  mfaPending: boolean;
  /** Finishes that sign-in with an authenticator or recovery code. */
  verifyMfa: (code: string) => Promise<void>;
  /** Abandons it, back to the password. */
  cancelMfa: () => void;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  /**
   * Records locally that onboarding just finished, so AuthGate lets the person
   * on even if the follow-up refresh of /me is slow or fails.
   */
  markOnboarded: () => void;
  /** False when this platform has no Google client id configured. */
  googleAvailable: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Owns the Google auth request.
 *
 * This lives in its own component so the hook can be skipped entirely:
 * `useIdTokenAuthRequest` throws *during render* when no client id resolves
 * for the platform, which would take down the whole app on launch rather than
 * just disabling one button. Rules of hooks say a hook can't be conditional —
 * but mounting the component that owns it can be.
 */
function GoogleAuthBridge({
  onPromptReady, onIdToken,
}: {
  onPromptReady: (prompt: () => Promise<unknown>) => void;
  onIdToken: (idToken: string) => void;
}) {
  const [, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    clientId: GOOGLE_WEB_CLIENT_ID,
  });

  useEffect(() => {
    onPromptReady(promptAsync);
  }, [promptAsync, onPromptReady]);

  useEffect(() => {
    if (response?.type !== "success") return;
    const idToken = (response.params as Record<string, string> | undefined)?.id_token;
    if (idToken) onIdToken(idToken);
  }, [response, onIdToken]);

  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<any | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [challenge, setChallenge] = useState<string | null>(null);

  /** A session signs the person in; a challenge waits for their code. */
  const accept = useCallback((result: Session | MfaChallenge) => {
    if (isMfaChallenge(result)) { setChallenge(result.challengeToken); return; }
    setChallenge(null);
    setUser(result.user);
    setProfile(result.profile);
  }, []);

  // Held in a ref rather than state: the bridge hands this over on mount, and
  // storing it in state would re-render the whole tree for no reason.
  const promptRef = useRef<(() => Promise<unknown>) | null>(null);

  /*
   * Catch the link that opened the app, before anything else navigates away
   * from it. Fire-and-forget and first-touch — see src/api/attribution.ts.
   */
  useEffect(() => { void captureAttribution(); }, []);

  // Restore a stored session on launch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const me = await fetchMe();
        if (!cancelled) {
          setUser(me.user);
          setProfile(me.profile);
        }
      } catch {
        // An unusable stored token shouldn't wedge the app on a blank screen.
        await clearSession();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /*
   * Everything the query cache holds for the person who just left.
   *
   * The QueryClient is made once, at module scope in app/_layout.tsx, so it
   * outlives any session: dropping the tokens leaves every answered query —
   * conversations, the profile summary, projects, notification counts — sitting
   * in memory under keys the next account uses too. Hand the phone over, let
   * them sign in, and for the 30 seconds of `staleTime` (longer for anything
   * that only refetches on demand) they are reading the previous person's
   * inbox. `clear()` removes the data as well as the queries, so nothing is
   * served from cache while the new account's requests are in flight.
   *
   * Both ways out have to do it. Session expiry drops to sign-in without ever
   * calling signOut, and that is the path a shared or stolen phone takes.
   */
  const forgetEverything = useCallback(() => {
    setUser(null);
    setProfile(null);
    setChallenge(null);
    queryClient.clear();
  }, [queryClient]);

  // Drop to the sign-in screen when a refresh fails server-side.
  useEffect(() => {
    setSessionExpiredHandler(forgetEverything);
  }, [forgetEverything]);

  const handlePromptReady = useCallback((prompt: () => Promise<unknown>) => {
    promptRef.current = prompt;
  }, []);

  // Exchange Google's id_token for one of our own sessions.
  const handleIdToken = useCallback(async (idToken: string) => {
    try {
      accept(await loginWithGoogle(idToken));
    } catch (err) {
      console.error("Google sign-in exchange failed:", err);
    }
  }, [accept]);

  const signIn = useCallback(async (email: string, password: string) => {
    accept(await apiLogin(email, password));
  }, [accept]);

  const verifyMfa = useCallback(async (code: string) => {
    if (!challenge) throw new Error("That sign-in has expired. Enter your password again.");
    accept(await apiVerifyMfa(challenge, code));
  }, [challenge, accept]);

  const cancelMfa = useCallback(() => setChallenge(null), []);

  const signUp = useCallback(async (input: {
    email: string; password: string; firstName?: string; lastName?: string;
  }) => {
    const session = await apiRegister(input);
    setUser(session.user);
    setProfile(session.profile);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!promptRef.current) {
      throw new Error("Google sign-in isn't set up for this build. Use your email and password.");
    }
    await promptRef.current();
  }, []);

  const signOut = useCallback(async () => {
    await apiLogout();
    forgetEverything();
  }, [forgetEverything]);

  const refreshUser = useCallback(async () => {
    try {
      const me = await fetchMe();
      setUser(me.user);
      setProfile(me.profile);
    } catch {
      // Non-fatal: keep showing what we have.
    }
  }, []);

  const markOnboarded = useCallback(() => {
    setProfile((p: any) => ({ ...(p ?? {}), isOnboarded: true }));
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user, profile, loading, signIn, signUp, signInWithGoogle, signOut,
        mfaPending: challenge != null, verifyMfa, cancelMfa,
        refreshUser, markOnboarded, googleAvailable: GOOGLE_CONFIGURED,
      }}
    >
      {GOOGLE_CONFIGURED && (
        <GoogleAuthBridge onPromptReady={handlePromptReady} onIdToken={handleIdToken} />
      )}
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
