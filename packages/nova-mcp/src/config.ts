/**
 * Where Nova is, and who we are when we talk to it.
 *
 * Everything comes from the environment, because that's what every MCP client
 * config file can set. No config file of our own: one more place for a token
 * to end up on disk, and one more thing to explain.
 */
export interface Config {
  baseUrl: string;
  token: string;
  /** Set by --project or NOVA_PROJECT_ID, and used as the default for every call. */
  projectId: string | null;
  /** Where the working tree is. Defaults to the process's cwd, which is the repo the editor opened. */
  root: string;
}

const flag = (argv: string[], name: string): string | null => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : null;
};

export function loadConfig(argv = process.argv.slice(2), env = process.env): Config {
  const token = flag(argv, "token") ?? env.NOVA_TOKEN ?? "";
  if (!token) {
    throw new Error(
      "No Nova token. Create one in SparkTower under Settings → Editor access, then set NOVA_TOKEN in your MCP client config.",
    );
  }
  return {
    baseUrl: (flag(argv, "url") ?? env.NOVA_BASE_URL ?? "https://sparktower.app").replace(/\/+$/, ""),
    token,
    projectId: flag(argv, "project") ?? env.NOVA_PROJECT_ID ?? null,
    root: flag(argv, "root") ?? env.NOVA_ROOT ?? process.cwd(),
  };
}
