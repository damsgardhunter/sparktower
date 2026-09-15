import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Icon, type IconName } from "../ui";

/**
 * The website's landing page below the hero (client/src/pages/landing.tsx),
 * stacked for a phone: Why SparkTower, the numbers, who it's for, how it
 * works, the vision, and the closing call to action. Copy is the web's, word
 * for word — restated here because the app can't import client/.
 */
export function LandingSections({ onJoin }: { onJoin: () => void }) {
  return (
    <View>
      <Block tone="card">
        <Heading title="Why SparkTower?" sub="We provide the tools and network to turn your vision into reality." />
        {FEATURES.map((f) => (
          <FeatureCard key={f.title} icon={f.icon} tint={f.tint} title={f.title} body={f.body} />
        ))}
      </Block>

      <Block>
        <View style={s.stats}>
          {STATS.map((st) => (
            <View key={st.label} style={s.stat}>
              <Icon name={st.icon} size={22} color={colors.primary} />
              <Text style={s.statValue}>{st.value}</Text>
              <Text style={s.statLabel}>{st.label}</Text>
            </View>
          ))}
        </View>
      </Block>

      <Block tone="card">
        <Heading title="Built for Builders Like You" sub="Whether you're going solo or looking for your dream team, SparkTower meets you where you are." />
        {PERSONAS.map((p) => (
          <FeatureCard key={p.title} icon={p.icon} tint={p.tint} title={p.title} quote={p.quote} body={p.body} />
        ))}
      </Block>

      <Block>
        <Heading title="How It Works" sub="Four steps from sign-up to launch. No gatekeeping, no waiting — just building." />
        {HOW.map((h) => (
          <View key={h.step} style={s.howRow}>
            <View style={s.howIcon}><Icon name={h.icon} size={22} color={colors.primary} /></View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.howStep}>STEP {h.step}</Text>
              <Text style={s.cardTitle}>{h.title}</Text>
              <Text style={s.cardBody}>{h.desc}</Text>
            </View>
          </View>
        ))}
      </Block>

      <View style={s.vision}>
        <View style={s.visionIcon}><Icon name="flash" size={28} color={colors.primary} /></View>
        <Text style={s.visionQuote}>
          "If you want to find the secrets of the universe, think in terms of <Text style={{ color: colors.primary }}>energy, frequency, and vibration.</Text>"
        </Text>
        <View style={s.visionAttr}><Text style={s.visionAttrText}>— Nikola Tesla</Text></View>
        <Text style={s.visionBody}>
          Tesla saw connections where others saw chaos. SparkTower is built on that same frequency — matching the right energy between builders, amplifying the vibration of collaboration, and channeling it into projects that reshape industries. This isn't just a platform. It's a movement for the ones who build the future.
        </Text>
      </View>

      <Block>
        <View style={{ alignItems: "center", gap: spacing.md }}>
          <Text style={[s.h2, { textAlign: "center" }]}>The future won't build itself.</Text>
          <Text style={[s.sub, { textAlign: "center" }]}>
            Every great invention started with one person who refused to wait for permission. Your project, your team, your legacy — it starts right here.
          </Text>
          <Pressable onPress={onJoin} style={({ pressed }) => [s.joinBtn, pressed && { opacity: 0.8 }]} testID="button-join-sparktower">
            <Text style={s.joinText}>Join SparkTower</Text>
            <Icon name="arrow-forward" size={18} color={colors.primaryText} />
          </Pressable>
          <Text style={s.fine}>Free to start. No credit card required.</Text>
        </View>
      </Block>

      <View style={s.footer}>
        <Text style={s.footerBrand}>SparkTower</Text>
        <Text style={s.cardBody}>
          Where visionary builders connect, collaborate, and create the future. Inspired by Tesla's belief that the greatest achievements come from bold collaboration.
        </Text>
        <Text style={s.fine}>© {new Date().getFullYear()} SparkTower. Built for the future of collaboration.</Text>
        <Text style={[s.fine, { fontStyle: "italic" }]}>"The present is theirs; the future is mine." — Nikola Tesla</Text>
      </View>
    </View>
  );
}

function Block({ children, tone }: { children: React.ReactNode; tone?: "card" }) {
  return (
    <View style={[s.block, tone === "card" && { backgroundColor: colors.surfaceRaised }]}>
      {children}
    </View>
  );
}

function Heading({ title, sub }: { title: string; sub: string }) {
  return (
    <View style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
      <Text style={[s.h2, { textAlign: "center" }]}>{title}</Text>
      <Text style={[s.sub, { textAlign: "center" }]}>{sub}</Text>
    </View>
  );
}

function FeatureCard({ icon, tint, title, quote, body }: { icon: IconName; tint: string; title: string; quote?: string; body: string }) {
  return (
    <View style={s.card}>
      <View style={[s.cardIcon, { backgroundColor: tint + "1A" }]}><Icon name={icon} size={22} color={tint} /></View>
      <Text style={s.cardTitle}>{title}</Text>
      {quote ? <Text style={[s.cardBody, { fontStyle: "italic" }]}>{quote}</Text> : null}
      <Text style={s.cardBody}>{body}</Text>
    </View>
  );
}

const FEATURES: { icon: IconName; tint: string; title: string; body: string }[] = [
  { icon: "locate-outline", tint: colors.primary, title: "AI Matching", body: "Our smart algorithm matches you with users based on skills, interests, and experience level." },
  { icon: "chatbubble-ellipses-outline", tint: "#10B981", title: "AI Project Chat", body: "Guided project creation with an AI assistant that helps you plan roadmaps, teams, and roles." },
  { icon: "flash-outline", tint: "#F59E0B", title: "Showcase & Scale", body: "Display your code, receive donations, and climb the leaderboard as your project gains traction." },
];

const STATS: { icon: IconName; value: string; label: string }[] = [
  { icon: "people-outline", value: "10,000+", label: "Builders & Creators" },
  { icon: "rocket-outline", value: "2,500+", label: "Projects Launched" },
  { icon: "bulb-outline", value: "50,000+", label: "AI Matches Made" },
  { icon: "globe-outline", value: "120+", label: "Countries Represented" },
];

const PERSONAS: { icon: IconName; tint: string; title: string; quote: string; body: string }[] = [
  { icon: "bulb-outline", tint: colors.primary, title: "Solo Founders", quote: "\"I have the vision, but I need the right people to make it real.\"", body: "Stop pitching into the void. SparkTower's AI matches you with co-founders who share your drive and complement your skills — so you can move from idea to launch, faster." },
  { icon: "construct-outline", tint: "#10B981", title: "Freelancers & Specialists", quote: "\"I'm tired of one-off gigs. I want to build something that matters.\"", body: "Your skills deserve more than a marketplace listing. Join projects you believe in, earn reputation through real collaboration, and build a portfolio that proves your impact." },
  { icon: "flash-outline", tint: "#F59E0B", title: "Side-Project Builders", quote: "\"I build on nights and weekends, but I feel like I'm doing it alone.\"", body: "You're not alone anymore. Connect with others who share your hustle. Practice sprints with our AI, compete in hackathons, and turn your side project into your main thing." },
];

const HOW: { step: string; icon: IconName; title: string; desc: string }[] = [
  { step: "01", icon: "person-add-outline", title: "Sign Up", desc: "Create your free account in under a minute. No credit card required." },
  { step: "02", icon: "person-outline", title: "Build Your Profile", desc: "Tell us your skills, interests, and what you're looking to build. Our AI learns what makes you unique." },
  { step: "03", icon: "search-outline", title: "Get Matched", desc: "Our AI finds builders who complement your strengths. Try a 24-hour sprint to test the fit before committing." },
  { step: "04", icon: "hand-left-outline", title: "Launch Together", desc: "Collaborate with built-in project tools, AI assistance, and a community cheering you on." },
];

const s = StyleSheet.create({
  block: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xl, gap: spacing.md, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  h2: { color: colors.text, fontSize: 26, lineHeight: 32, fontFamily: fontFamily.bold, letterSpacing: -0.5 },
  sub: { color: colors.textSecondary, fontSize: font.base, lineHeight: 22, fontFamily: fontFamily.regular },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  cardIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardTitle: { color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold },
  cardBody: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 20, fontFamily: fontFamily.regular },
  stats: { flexDirection: "row", flexWrap: "wrap", rowGap: spacing.lg },
  stat: { width: "50%", alignItems: "center", gap: 4 },
  statValue: { color: colors.text, fontSize: 28, fontFamily: fontFamily.bold, letterSpacing: -0.5 },
  statLabel: { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.medium },
  howRow: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  howIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  howStep: { color: colors.primary, fontSize: font.xs, fontFamily: fontFamily.bold, letterSpacing: 2 },
  vision: { backgroundColor: "#000000", paddingHorizontal: spacing.lg, paddingVertical: spacing.xxl, alignItems: "center", gap: spacing.lg },
  visionIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: "rgba(151,69,181,0.2)", alignItems: "center", justifyContent: "center" },
  visionQuote: { color: "#FFFFFF", fontSize: 22, lineHeight: 30, fontFamily: fontFamily.bold, fontStyle: "italic", textAlign: "center" },
  visionAttr: { backgroundColor: "rgba(255,255,255,0.1)", paddingHorizontal: spacing.md, paddingVertical: 4 },
  visionAttrText: { color: "rgba(255,255,255,0.8)", fontSize: font.sm, fontFamily: fontFamily.semibold },
  visionBody: { color: "rgba(255,255,255,0.7)", fontSize: font.base, lineHeight: 24, fontFamily: fontFamily.regular, textAlign: "center" },
  joinBtn: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.xl, paddingVertical: 14, marginTop: spacing.sm },
  joinText: { color: colors.primaryText, fontSize: font.base, fontFamily: fontFamily.bold },
  fine: { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular, textAlign: "center" },
  footer: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xl, gap: spacing.sm, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised },
  footerBrand: { color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold },
});
