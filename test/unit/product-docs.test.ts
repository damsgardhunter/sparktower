/**
 * The audit reads the builder's own docs: markdown that talks about loops,
 * journeys and the plan is ranked, excerpted around the relevant passages,
 * and boilerplate is left out.
 */
import { describe, it, expect } from "vitest";
import { collectProductDocs } from "../../server/code-digest";

const file = (path: string, content: string) => ({ path, size: content.length, content });

describe("collectProductDocs", () => {
  it("ranks docs by how much they say about loops and excerpts those passages with their heading", () => {
    const docs = collectProductDocs([
      // Paragraphs under a heading about loops count even without the word; paragraphs elsewhere don't.
      file("README.md", "# App\n\nInstall with npm.\n\nUnrelated paragraph about licensing.\n\n## Loops\n\nThe build loop: post a check-in, get comments, post again.\n\nPeople come back every week for it."),
      file("docs/product/loops.md", "# Loops we are going for\n\n## Build loop\n\nBuilder posts weekly → gets feedback → returns.\n\n## Explore loop\n\nVisitor reads the feed → follows a project → comes back for updates.\n\n## Fund loop\n\nBacker backs a project → gets updates → backs again."),
      file("CHANGELOG.md", "## 1.0\n- loop fixed\n- loop fixed again\n- loop loop loop"),
      file("node_modules/x/README.md", "loop loop loop loop loop"),
      file("docs/setup.md", "# Setup\n\nRun the migrations."),
    ]);
    expect(docs.map((d) => d.path)).toEqual(["docs/product/loops.md", "README.md"]);
    expect(docs[0].intentHits).toBeGreaterThan(docs[1].intentHits);
    expect(docs[0].excerpt).toContain("[Build loop] Builder posts weekly");
    expect(docs[0].excerpt).toContain("[Fund loop]");
    expect(docs[1].excerpt).not.toContain("licensing");
    expect(docs[1].excerpt).not.toContain("Install with npm");
    expect(docs[1].excerpt).toContain("[Loops] People come back every week");
  });

  it("caps the number of docs and the size of each excerpt", () => {
    const many = Array.from({ length: 12 }, (_, i) => file(`docs/${i}.md`, `# D${i}\n\n${"the loop is the thing. ".repeat(300)}`));
    const docs = collectProductDocs(many, 3, 500);
    expect(docs).toHaveLength(3);
    for (const d of docs) expect(d.excerpt.length).toBeLessThanOrEqual(520);
  });
});
