import { defineEval, includes } from "@grok/agent-sdk/evals";

const poetry = {
  id: "poetry-1",
  text: "The monsoon writes silver letters on the tin roof, and every drop remembers the sea.",
};

const story = {
  id: "story-1",
  text: "Maya left Chennai with one suitcase and a promise she would return when the jasmine bloomed again.",
};

const caseStudy = {
  id: "case-1",
  text: "Acme Labs cut checkout drop-off by 18% after redesigning the payment flow for first-time mobile buyers.",
};

const paper = {
  id: "paper-1",
  text: "We find that bilingual readers retain narrative tone better when translations prioritize meaning over lexical alignment (p < 0.05).",
};

function batchPrompt(
  contentLabel: string,
  segment: { id: string; text: string },
  targetLanguage: string,
): string {
  return [
    `Translate this ${contentLabel} segment into ${targetLanguage} for in-place Framer replacement.`,
    "Detect language and content type, preserve meaning and tone (not word-for-word), keep proper nouns, then call submit_replacements.",
    "",
    "Segments (JSON):",
    JSON.stringify([segment], null, 2),
  ].join("\n");
}

type BatchInput = {
  targetLanguage?: string;
  contentType?: string;
  replacements?: Array<{ id: string; translated: string }>;
};

function translatedFor(input: unknown, id: string): string {
  const body = input as BatchInput;
  return body.replacements?.find((item) => item.id === id)?.translated ?? "";
}

export default defineEval({
  tags: ["smoke", "meaning"],
  description:
    "Meaning-first translation submits structured replacements for poetry, story, case study, and paper samples.",
  cases: [
    {
      id: "poetry-hi",
      description: "Poetry sample retains imagery when translating to Hindi.",
      async test(t) {
        await t.send(batchPrompt("poetry", poetry, "hi"));
        t.succeeded();
        t.calledTool("submit_replacements", {
          input: (value) => {
            const body = value as BatchInput;
            const translated = translatedFor(value, poetry.id);
            return (
              body.targetLanguage === "hi" &&
              body.contentType === "poetry" &&
              translated.length > 0 &&
              translated !== poetry.text
            );
          },
        });
        t.check(t.reply, includes(/hi|Hindi|poetry|segment/i));
      },
    },
    {
      id: "story-ta",
      description: "Story sample keeps narrative voice toward Tamil.",
      async test(t) {
        await t.send(batchPrompt("narrative story", story, "ta"));
        t.succeeded();
        t.calledTool("submit_replacements", {
          input: (value) => {
            const body = value as BatchInput;
            const translated = translatedFor(value, story.id);
            return (
              body.targetLanguage === "ta" &&
              body.contentType === "narrative" &&
              translated.length > 0 &&
              /Maya/.test(translated) &&
              /Chennai/.test(translated)
            );
          },
        });
      },
    },
    {
      id: "case-study-es",
      description: "Case study keeps metrics and proper nouns in Spanish.",
      async test(t) {
        await t.send(batchPrompt("case study", caseStudy, "es"));
        t.succeeded();
        t.calledTool("submit_replacements", {
          input: (value) => {
            const body = value as BatchInput;
            const translated = translatedFor(value, caseStudy.id);
            return (
              body.targetLanguage === "es" &&
              body.contentType === "case_study" &&
              /18\s*%/.test(translated) &&
              /Acme Labs/.test(translated)
            );
          },
        });
      },
    },
    {
      id: "paper-fr",
      description: "Paper sample preserves claim hedging toward French.",
      async test(t) {
        await t.send(batchPrompt("research paper", paper, "fr"));
        t.succeeded();
        t.calledTool("submit_replacements", {
          input: (value) => {
            const body = value as BatchInput;
            const translated = translatedFor(value, paper.id);
            return (
              body.targetLanguage === "fr" &&
              body.contentType === "paper" &&
              translated.length > 0 &&
              /p\s*<\s*0\.05/i.test(translated)
            );
          },
        });
      },
    },
  ],
});
