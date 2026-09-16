/**
 * The guards in front of the destructive test helpers.
 *
 * `applySchema` drops every table in `public` when a database has no migration
 * bookkeeping, and `truncateAll` empties every table between tests. Both are
 * right for a test database and catastrophic anywhere else, so what stops them
 * is checked here rather than assumed: the database's name, asked of the server
 * rather than parsed from a URL, and the environment on top of it.
 */
import { describe, it, expect, afterEach, vi } from "vitest";

const { assertTestDatabaseNameForTests } = await import("../setup/database");

const env = process.env.NODE_ENV;
afterEach(() => { process.env.NODE_ENV = env; delete process.env.ALLOW_DESTRUCTIVE_TEST_DB; });

describe("what stops a destructive helper", () => {
  it("takes only databases named as test databases", () => {
    expect(() => assertTestDatabaseNameForTests("project_test")).not.toThrow();
    expect(() => assertTestDatabaseNameForTests("project_e2e")).not.toThrow();
    for (const name of ["project", "sparktower", "project_prod", "testing", "project_test_backup"]) {
      expect(() => assertTestDatabaseNameForTests(name), name).toThrow(/Refusing to touch database/);
    }
  });

  it("refuses in production even when the name looks like a test database", () => {
    process.env.NODE_ENV = "production";
    expect(() => assertTestDatabaseNameForTests("project_test")).toThrow(/production process/);
    // A deliberate, documented override exists for the rare case of running the suite against a production-like box.
    process.env.ALLOW_DESTRUCTIVE_TEST_DB = "yes-really";
    expect(() => assertTestDatabaseNameForTests("project_test")).not.toThrow();
    expect(() => assertTestDatabaseNameForTests("project"), "the name check still applies").toThrow(/must end in/);
  });
});
