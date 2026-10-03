/**
 * Proving a company owns its website — the phone's half of
 * client/src/components/company/verify-domain.tsx and company-verification.tsx.
 *
 * Verification is what the rest of the surface hangs off: an unverified company
 * keeps its people, its seasons and its recruiting, but cannot put a challenge
 * in front of strangers or approach anybody. So "why can't we post a challenge"
 * had an answer the phone could show and no way to act on.
 *
 * The two ways both prove something a stranger cannot do: put a file on the
 * site, or change its DNS. Whichever is chosen, the phone shows the exact file
 * contents and the exact record name, because the person doing this has a
 * hosting panel or a DNS provider open in another window.
 *
 * None of those strings are written here. The server sends `steps` with the
 * domain and token already in them, and the phone renders what it is given —
 * a second copy of a path like `/.well-known/sparktower-verification.txt`
 * would be a path that can drift from the one actually being checked.
 */
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { api } from "../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Btn, Field, Icon, Loading, Row, errText } from "../ui";
import { Callout, TitledCard } from "../MoreKit";
import { Pill } from "../nova/Pill";
import { text } from "../more/AdminKit";
import type { Notice } from "../Sheet";
import { companyKey, type CompanyView } from "./kit";

type Method = "file" | "dns";

interface Verification {
  id: string;
  domain: string;
  token: string;
  verified: boolean;
  method: Method | null;
  spent: boolean;
  attempts: number;
  attemptsLeft: number;
  lastError: string | null;
  expiresAt: string;
  steps: Record<Method, { title: string; steps: string[] }>;
}

export function VerifyDomain({ companyId, notify }: { companyId: string; notify: (n: Notice) => void }) {
  const qc = useQueryClient();
  const { data: view } = useQuery<CompanyView>({ queryKey: companyKey(companyId) });
  const [website, setWebsite] = useState("");
  const [method, setMethod] = useState<Method>("file");
  const [working, setWorking] = useState<string | null>(null);

  const mine = useQuery({
    queryKey: ["company-verifications"],
    queryFn: () => api<{ verifications: Verification[] }>("/api/company-verifications"),
  });

  const start = useMutation({
    mutationFn: () => api<{ verification: Verification }>("/api/company-verifications", { method: "POST", body: { website: website.trim() } }),
    onSuccess: (r) => {
      setWorking(r.verification.id);
      setWebsite("");
      void mine.refetch();
    },
    /*
     * Three of the server's refusals here are the whole value of asking first:
     * a domain that is not a domain, one nobody can claim, and one already
     * verified by another company — said before somebody edits DNS for an hour.
     */
    onError: (e) => notify({ text: errText(e, "Couldn't start that."), tone: "error" }),
  });

  const check = useMutation({
    mutationFn: (id: string) => api<{ verification: Verification }>(`/api/company-verifications/${id}/check`, { method: "POST", body: {} }),
    onSuccess: async () => {
      await mine.refetch();
      notify({ text: "Found it. Now attach it to the company.", tone: "success" });
    },
    /*
     * A failed check is the normal case, not an error: "no TXT record at
     * _sparktower.acme.com yet" is the difference between finishing and giving
     * up, and the server puts exactly what it saw in the message.
     */
    onError: (e) => { void mine.refetch(); notify({ text: errText(e, "Couldn't check that."), tone: "error" }); },
  });

  const attach = useMutation({
    mutationFn: (verificationId: string) => api(`/api/companies/${companyId}/verify`, { method: "POST", body: { verificationId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: companyKey(companyId) });
      void mine.refetch();
      notify({ text: "Verified. The company can post challenges and recruit now.", tone: "success" });
    },
    onError: (e) => notify({ text: errText(e, "Couldn't attach that."), tone: "error" }),
  });

  if (!view) return null;
  const company = view.company;

  if (company.verifiedDomain) {
    return (
      <Callout
        icon="checkmark-circle"
        tone="success"
        title={`Verified as ${company.verifiedDomain}`}
        body={`Proved by ${company.verifiedMethod === "dns" ? "a DNS record" : "a file on the site"}. Get in touch if that needs to change.`}
      />
    );
  }

  const all = mine.data?.verifications ?? [];
  /* A verification already attached to a company is spent and cannot be reused. */
  const usable = all.filter((v) => !v.spent);
  const current = usable.find((v) => v.id === working) ?? usable[0] ?? null;

  return (
    <View style={{ gap: spacing.md }}>
      <TitledCard icon="shield-checkmark" title="Prove the website">
        <Text style={text.meta}>
          Until this is done the company cannot post a challenge or approach anybody. It proves something a stranger
          could not do: putting a file on the site, or changing its DNS.
        </Text>
        <Field
          label="The company's domain"
          value={website}
          onChangeText={setWebsite}
          placeholder="acme.com"
          autoCapitalize="none"
          keyboardType="default"
          testID="verify-domain-input"
        />
        <Btn
          label="Start"
          loading={start.isPending}
          disabled={!website.trim()}
          onPress={() => start.mutate()}
          testID="start-verification"
        />
      </TitledCard>

      {mine.isLoading ? <Loading /> : null}

      {current ? (
        <TitledCard
          icon="document-text"
          title={current.domain}
          action={current.verified ? <Pill label="found" tone="good" /> : <Pill label={`${current.attemptsLeft} checks left`} tone={current.attemptsLeft > 0 ? "neutral" : "bad"} />}
        >
          {current.verified ? (
            <View style={{ gap: spacing.sm }}>
              <Text style={text.meta}>The token was found. Attach it and the company is verified.</Text>
              <Btn label="Attach to this company" loading={attach.isPending} onPress={() => attach.mutate(current.id)} testID="attach-verification" />
            </View>
          ) : (
            <View style={{ gap: spacing.sm }}>
              <Row gap={6}>
                {(["file", "dns"] as Method[]).map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => setMethod(m)}
                    testID={`verify-method-${m}`}
                    style={{
                      paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1,
                      borderColor: method === m ? colors.primary : colors.border,
                      backgroundColor: method === m ? colors.primarySoft : "transparent",
                    }}
                  >
                    <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: method === m ? colors.primary : colors.textSecondary }}>
                      {current.steps[m].title}
                    </Text>
                  </Pressable>
                ))}
              </Row>

              {/*
                * The steps as the server wrote them, numbered. Tapping one
                * copies it, because the thing somebody needs next is the token
                * in their hosting panel's clipboard, and reading a token off a
                * phone screen into another device is how a character gets lost.
                */}
              {current.steps[method].steps.map((s, i) => (
                <Pressable
                  key={i}
                  testID={`verify-step-${method}-${i}`}
                  onPress={async () => {
                    await Clipboard.setStringAsync(s).catch(() => {});
                    notify({ text: "Copied", tone: "success" });
                  }}
                  style={{ flexDirection: "row", gap: spacing.sm, paddingVertical: 5 }}
                >
                  <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.semibold }}>{i + 1}</Text>
                  <Text style={{ flex: 1, color: colors.text, fontSize: font.xs }}>{s}</Text>
                  <Icon name="copy-outline" size={13} color={colors.textTertiary} />
                </Pressable>
              ))}

              <Pressable
                testID="copy-token"
                onPress={async () => {
                  await Clipboard.setStringAsync(current.token).catch(() => {});
                  notify({ text: "Token copied", tone: "success" });
                }}
                style={{ backgroundColor: colors.canvas, borderRadius: radius.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.border }}
              >
                <Text style={{ color: colors.textTertiary, fontSize: 10, fontFamily: fontFamily.semibold }}>THE TOKEN — TAP TO COPY</Text>
                <Text style={{ color: colors.text, fontSize: font.xs, fontFamily: fontFamily.medium }} numberOfLines={2}>{current.token}</Text>
              </Pressable>

              {/* What the check actually saw. "No TXT record yet" is the difference between finishing and giving up. */}
              {current.lastError ? <Callout icon="information-circle" tone="warn" body={current.lastError} /> : null}

              <Btn
                label={current.attemptsLeft > 0 ? "Check now" : "Start again for a fresh token"}
                loading={check.isPending}
                disabled={current.attemptsLeft <= 0}
                onPress={() => check.mutate(current.id)}
                testID="check-verification"
              />
              <Text style={text.small}>
                Expires {new Date(current.expiresAt).toLocaleDateString()}. DNS can take a few minutes to publish.
              </Text>
            </View>
          )}
        </TitledCard>
      ) : null}

      {/* The others, so a half-finished one is findable rather than lost. */}
      {usable.length > 1 ? (
        <TitledCard icon="list" title="Other attempts">
          {usable.filter((v) => v.id !== current?.id).map((v) => (
            <Row key={v.id} between center style={{ paddingVertical: 6 }}>
              <Text style={{ flex: 1, color: colors.text, fontSize: font.sm }} numberOfLines={1}>{v.domain}</Text>
              <Btn small variant="ghost" label="Open" onPress={() => setWorking(v.id)} testID={`open-verification-${v.id}`} />
            </Row>
          ))}
        </TitledCard>
      ) : null}
    </View>
  );
}
