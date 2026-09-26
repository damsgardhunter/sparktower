/**
 * Language, for the parts of the product that have been translated.
 *
 * ## What this is, and what it is not
 *
 * This is a real translation layer: a dictionary per language, a hook that
 * reads it, and a stored preference that survives a reload. It is *not* a
 * translated product. At the time of writing exactly one surface is
 * translated — the footer — because that is what has been written, and a
 * picker that claimed the whole app would be a claim the app cannot meet.
 *
 * That honesty is load-bearing. A language switcher that changes a setting
 * nothing reads is worse than no switcher: somebody chooses Español, the
 * screen stays in English, and the reasonable conclusion is that the feature
 * is broken rather than unfinished. So the footer says how much is translated,
 * and `t()` falls back to English for anything a language has no line for —
 * a missing translation shows the English rather than a key or a blank.
 *
 * ## Adding a language
 *
 * Add it to `LANGUAGES` and give `STRINGS` a block for it. A language with a
 * partial block is fine and is the normal case: every key falls back.
 *
 * ## Adding a string
 *
 * Add it to `en` first — that is the source of truth and the fallback — then
 * to whichever languages have it. TypeScript keeps the other languages honest
 * about *spelling* a key, not about having one.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Ten languages, by how many people would actually read them here.
 *
 * `native` is what the language calls itself, because a person looking for
 * their own language scans for the word they use, not for the English name of
 * it. `dir` is on the two that need it — leaving it off is how a right-to-left
 * language ends up laid out backwards.
 */
export interface Language {
  code: string;
  /** What English calls it, for the label a search would match. */
  english: string;
  /** What it calls itself. */
  native: string;
  dir?: "rtl";
}

export const LANGUAGES: Language[] = [
  { code: "en", english: "English", native: "English" },
  { code: "es", english: "Spanish", native: "Español" },
  { code: "zh", english: "Chinese (Simplified)", native: "简体中文" },
  { code: "hi", english: "Hindi", native: "हिन्दी" },
  { code: "ar", english: "Arabic", native: "العربية", dir: "rtl" },
  { code: "pt", english: "Portuguese", native: "Português" },
  { code: "fr", english: "French", native: "Français" },
  { code: "de", english: "German", native: "Deutsch" },
  { code: "ja", english: "Japanese", native: "日本語" },
  { code: "ru", english: "Russian", native: "Русский" },
];

export const languageOf = (code: string): Language =>
  LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];

/** Every string that has been translated. English is the source and the fallback. */
const en = {
  "footer.language": "Language",
  "footer.languageNote": "Only this footer is translated so far. The rest of the product is in English.",
  "footer.report": "Is there a problem? Report it",
  "footer.careers": "Careers",
  "footer.switchTitle": "Switch to {language}?",
  "footer.switchBody":
    "The parts of the product that have been translated will change to {language}. Everything else stays in English until it is translated.",
  "footer.switchConfirm": "Switch to {language}",
  "footer.switchCancel": "Stay in {language}",
  "careers.title": "Careers",
  "careers.none": "No jobs available at the moment.",
  "careers.checkBack": "Check again another time — this page is where they will be when there are.",
  "careers.apply": "Apply anyway",
  "careers.applyNote":
    "No open roles means no application form yet. If you would have applied, say so in a problem report and it reaches the same place.",
} as const;

export type StringKey = keyof typeof en;

/**
 * The translations.
 *
 * Partial on purpose: a language block carries what has been translated, and
 * `t()` falls back to English for the rest. Filling one in is adding lines to
 * an object, not a code change.
 */
const STRINGS: Record<string, Partial<Record<StringKey, string>>> = {
  en,
  es: {
    "footer.language": "Idioma",
    "footer.languageNote": "Por ahora solo este pie de página está traducido. El resto del producto está en inglés.",
    "footer.report": "¿Hay algún problema? Infórmanos",
    "footer.careers": "Empleo",
    "footer.switchTitle": "¿Cambiar a {language}?",
    "footer.switchBody":
      "Las partes traducidas del producto cambiarán a {language}. El resto seguirá en inglés hasta que se traduzca.",
    "footer.switchConfirm": "Cambiar a {language}",
    "footer.switchCancel": "Seguir en {language}",
    "careers.title": "Empleo",
    "careers.none": "No hay vacantes en este momento.",
    "careers.checkBack": "Vuelve a consultar más adelante: aquí aparecerán cuando las haya.",
    "careers.apply": "Postularse de todos modos",
    "careers.applyNote":
      "Sin vacantes abiertas todavía no hay formulario. Si querías postularte, dilo en un informe de problema y llegará al mismo sitio.",
  },
  zh: {
    "footer.language": "语言",
    "footer.languageNote": "目前只有此页脚已翻译，产品的其余部分仍为英文。",
    "footer.report": "有问题吗？告诉我们",
    "footer.careers": "招聘",
    "footer.switchTitle": "切换到{language}？",
    "footer.switchBody": "已翻译的部分将切换为{language}，其余部分在翻译完成前仍为英文。",
    "footer.switchConfirm": "切换到{language}",
    "footer.switchCancel": "继续使用{language}",
    "careers.title": "招聘",
    "careers.none": "目前没有空缺职位。",
    "careers.checkBack": "请稍后再来查看——有职位时会在这里公布。",
    "careers.apply": "仍然申请",
    "careers.applyNote": "目前没有空缺，因此还没有申请表。如果你本想申请，请在问题反馈中说明，它会送到同一处。",
  },
  hi: {
    "footer.language": "भाषा",
    "footer.languageNote": "अभी केवल यह फ़ुटर अनुवादित है। बाकी उत्पाद अंग्रेज़ी में है।",
    "footer.report": "कोई समस्या है? हमें बताएं",
    "footer.careers": "करियर",
    "footer.switchTitle": "{language} पर स्विच करें?",
    "footer.switchBody":
      "उत्पाद के अनुवादित हिस्से {language} में बदल जाएंगे। बाकी अनुवाद होने तक अंग्रेज़ी में रहेंगे।",
    "footer.switchConfirm": "{language} पर स्विच करें",
    "footer.switchCancel": "{language} में ही रहें",
    "careers.title": "करियर",
    "careers.none": "इस समय कोई पद उपलब्ध नहीं है।",
    "careers.checkBack": "कभी और देखें — पद आने पर यहीं दिखेंगे।",
    "careers.apply": "फिर भी आवेदन करें",
    "careers.applyNote":
      "कोई पद खुला न होने से अभी फ़ॉर्म नहीं है। यदि आप आवेदन करना चाहते थे, तो समस्या रिपोर्ट में लिखें — वह वहीं पहुंचेगा।",
  },
  ar: {
    "footer.language": "اللغة",
    "footer.languageNote": "لم يُترجم حتى الآن سوى هذا التذييل. بقية المنتج بالإنجليزية.",
    "footer.report": "هل هناك مشكلة؟ أبلغنا",
    "footer.careers": "الوظائف",
    "footer.switchTitle": "التبديل إلى {language}؟",
    "footer.switchBody": "ستتغير الأجزاء المترجمة إلى {language}. وسيبقى الباقي بالإنجليزية حتى تُترجم.",
    "footer.switchConfirm": "التبديل إلى {language}",
    "footer.switchCancel": "البقاء على {language}",
    "careers.title": "الوظائف",
    "careers.none": "لا توجد وظائف متاحة حاليًا.",
    "careers.checkBack": "عُد لاحقًا — ستظهر هنا عند توفّرها.",
    "careers.apply": "قدّم على أي حال",
    "careers.applyNote":
      "لا توجد وظائف مفتوحة، ولذلك لا يوجد نموذج بعد. إن كنت ستتقدّم، فاذكر ذلك في بلاغ مشكلة وسيصل إلى المكان نفسه.",
  },
  pt: {
    "footer.language": "Idioma",
    "footer.languageNote": "Por enquanto só este rodapé está traduzido. O resto do produto está em inglês.",
    "footer.report": "Algum problema? Avise-nos",
    "footer.careers": "Carreiras",
    "footer.switchTitle": "Mudar para {language}?",
    "footer.switchBody":
      "As partes traduzidas mudarão para {language}. O restante continua em inglês até ser traduzido.",
    "footer.switchConfirm": "Mudar para {language}",
    "footer.switchCancel": "Continuar em {language}",
    "careers.title": "Carreiras",
    "careers.none": "Nenhuma vaga disponível no momento.",
    "careers.checkBack": "Volte outra hora — é aqui que elas aparecerão.",
    "careers.apply": "Candidatar-se mesmo assim",
    "careers.applyNote":
      "Sem vagas abertas ainda não há formulário. Se você se candidataria, diga num relato de problema — chega ao mesmo lugar.",
  },
  fr: {
    "footer.language": "Langue",
    "footer.languageNote": "Seul ce pied de page est traduit pour l'instant. Le reste du produit est en anglais.",
    "footer.report": "Un problème ? Signalez-le",
    "footer.careers": "Carrières",
    "footer.switchTitle": "Passer en {language} ?",
    "footer.switchBody":
      "Les parties traduites passeront en {language}. Le reste restera en anglais jusqu'à sa traduction.",
    "footer.switchConfirm": "Passer en {language}",
    "footer.switchCancel": "Rester en {language}",
    "careers.title": "Carrières",
    "careers.none": "Aucun poste disponible pour le moment.",
    "careers.checkBack": "Revenez plus tard — c'est ici qu'ils apparaîtront.",
    "careers.apply": "Postuler quand même",
    "careers.applyNote":
      "Sans poste ouvert, il n'y a pas encore de formulaire. Si vous auriez postulé, dites-le dans un signalement : cela arrive au même endroit.",
  },
  de: {
    "footer.language": "Sprache",
    "footer.languageNote": "Bisher ist nur diese Fußzeile übersetzt. Der Rest des Produkts ist auf Englisch.",
    "footer.report": "Gibt es ein Problem? Melden Sie es",
    "footer.careers": "Karriere",
    "footer.switchTitle": "Zu {language} wechseln?",
    "footer.switchBody":
      "Die übersetzten Teile wechseln zu {language}. Alles andere bleibt Englisch, bis es übersetzt ist.",
    "footer.switchConfirm": "Zu {language} wechseln",
    "footer.switchCancel": "Bei {language} bleiben",
    "careers.title": "Karriere",
    "careers.none": "Derzeit sind keine Stellen verfügbar.",
    "careers.checkBack": "Schauen Sie später wieder vorbei — hier werden sie stehen.",
    "careers.apply": "Trotzdem bewerben",
    "careers.applyNote":
      "Ohne offene Stellen gibt es noch kein Formular. Wenn Sie sich beworben hätten, schreiben Sie es in eine Problemmeldung — sie landet an derselben Stelle.",
  },
  ja: {
    "footer.language": "言語",
    "footer.languageNote": "現在翻訳されているのはこのフッターだけです。ほかは英語のままです。",
    "footer.report": "問題がありますか？ご報告ください",
    "footer.careers": "採用",
    "footer.switchTitle": "{language}に切り替えますか？",
    "footer.switchBody": "翻訳済みの部分が{language}に変わります。それ以外は翻訳されるまで英語のままです。",
    "footer.switchConfirm": "{language}に切り替える",
    "footer.switchCancel": "{language}のままにする",
    "careers.title": "採用",
    "careers.none": "現在募集中の職種はありません。",
    "careers.checkBack": "またの機会にご確認ください。募集が出ればここに掲載されます。",
    "careers.apply": "それでも応募する",
    "careers.applyNote":
      "募集がないため応募フォームはまだありません。応募したい場合は問題報告にお書きください。同じ場所に届きます。",
  },
  ru: {
    "footer.language": "Язык",
    "footer.languageNote": "Пока переведён только этот нижний колонтитул. Остальная часть продукта — на английском.",
    "footer.report": "Что-то не работает? Сообщите нам",
    "footer.careers": "Вакансии",
    "footer.switchTitle": "Переключиться на {language}?",
    "footer.switchBody":
      "Переведённые части станут на {language}. Остальное останется на английском до перевода.",
    "footer.switchConfirm": "Переключиться на {language}",
    "footer.switchCancel": "Остаться на {language}",
    "careers.title": "Вакансии",
    "careers.none": "Сейчас открытых вакансий нет.",
    "careers.checkBack": "Загляните позже — они появятся здесь.",
    "careers.apply": "Всё равно откликнуться",
    "careers.applyNote":
      "Открытых вакансий нет, поэтому формы пока тоже нет. Если бы вы откликнулись, напишите об этом в сообщении о проблеме — оно придёт туда же.",
  },
};

const STORAGE_KEY = "sparktower.language";

/**
 * What language to open in.
 *
 * The stored choice wins, then the browser's, then English. Wrapped in a
 * try/catch because `localStorage` throws rather than returning null in a
 * private window and behind some blockers, and a language preference is not
 * worth a white screen.
 */
function firstLanguage(): string {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && LANGUAGES.some((l) => l.code === saved)) return saved;
  } catch {
    /* No storage: fall through to the browser's own answer. */
  }
  const asked = typeof navigator !== "undefined" ? navigator.language?.slice(0, 2) : undefined;
  return LANGUAGES.some((l) => l.code === asked) ? asked! : "en";
}

interface Translation {
  language: Language;
  /** Look a string up, filling in `{name}` placeholders. Falls back to English. */
  t: (key: StringKey, vars?: Record<string, string>) => string;
  setLanguage: (code: string) => void;
}

const LanguageContext = createContext<Translation | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [code, setCode] = useState<string>(() => (typeof window === "undefined" ? "en" : firstLanguage()));
  const language = languageOf(code);

  /*
   * The document's own language and direction, which is not decoration: it is
   * what a screen reader announces in, what a browser offers to translate
   * from, and what makes an Arabic layout read right to left.
   */
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = language.code;
    document.documentElement.dir = language.dir ?? "ltr";
  }, [language]);

  const setLanguage = useCallback((next: string) => {
    setCode(languageOf(next).code);
    try {
      window.localStorage.setItem(STORAGE_KEY, languageOf(next).code);
    } catch {
      /* The choice still applies for this visit; it just will not survive one. */
    }
  }, []);

  const t = useCallback(
    (key: StringKey, vars?: Record<string, string>) => {
      const raw: string = STRINGS[code]?.[key] ?? en[key];
      if (!vars) return raw;
      return Object.entries(vars).reduce<string>((out, [name, value]) => out.split(`{${name}}`).join(value), raw);
    },
    [code],
  );

  const value = useMemo(() => ({ language, t, setLanguage }), [language, t, setLanguage]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/**
 * Translation for a component.
 *
 * Falls back to English rather than throwing when there is no provider, so a
 * component rendered outside one — a test, a story, a screen mounted before
 * the app shell — shows words rather than crashing.
 */
export function useLanguage(): Translation {
  const ctx = useContext(LanguageContext);
  if (ctx) return ctx;
  return {
    language: LANGUAGES[0],
    t: (key, vars) => {
      const raw: string = en[key];
      if (!vars) return raw;
      return Object.entries(vars).reduce<string>((out, [name, value]) => out.split(`{${name}}`).join(value), raw);
    },
    setLanguage: () => {},
  };
}
